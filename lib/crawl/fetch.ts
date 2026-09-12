import { Agent, interceptors, request } from "undici";

import { CAPS } from "@/lib/config";
import { USER_AGENT } from "@/lib/crawl/robots";

/**
 * HTTP fetching with honest failure states.
 *
 * Nothing here throws for an expected condition. A 403, a timeout, a
 * non-HTML response — each becomes a typed result that ends up as a Page row
 * and a visible line in the UI. The scan reports what it could not read.
 */

export type FetchStatus =
  | "OK"
  | "HTTP_ERROR"
  | "TIMEOUT"
  | "FETCH_FAILED"
  | "EXTRACT_EMPTY";

export type FetchResult = {
  url: string;
  /** Final URL after redirects. */
  finalUrl: string;
  status: FetchStatus;
  httpStatus: number | null;
  html: string | null;
  error: string | null;
  latencyMs: number;
};

/** Cap on response size — a 40MB page is not a source of pricing facts. */
const MAX_BYTES = 3_000_000;

/**
 * undici 8 removed `maxRedirections` from request options; redirects are now
 * a dispatcher interceptor. Built once and shared so connections are pooled
 * across the crawl rather than reopened per page.
 */
const dispatcher = new Agent().compose(
  interceptors.redirect({ maxRedirections: 5 }),
);

export async function fetchPage(
  url: string,
  timeoutMs: number = CAPS.FETCH_TIMEOUT_MS,
): Promise<FetchResult> {
  const started = Date.now();

  const base = {
    url,
    finalUrl: url,
    html: null,
    error: null,
    latencyMs: 0,
  };

  try {
    const response = await request(url, {
      method: "GET",
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
      },
      dispatcher,
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
    });

    const latencyMs = Date.now() - started;
    const httpStatus = response.statusCode;

    if (httpStatus >= 400) {
      // Drain so the connection can be reused.
      await response.body.dump();
      return {
        ...base,
        status: "HTTP_ERROR",
        httpStatus,
        latencyMs,
        error: `HTTP ${httpStatus}`,
      };
    }

    const contentType = String(response.headers["content-type"] ?? "");
    if (contentType && !/text\/html|application\/xhtml/i.test(contentType)) {
      await response.body.dump();
      return {
        ...base,
        status: "EXTRACT_EMPTY",
        httpStatus,
        latencyMs,
        error: `Not HTML (${contentType.split(";")[0]})`,
      };
    }

    const html = await readCapped(response.body, MAX_BYTES);

    return {
      ...base,
      status: "OK",
      httpStatus,
      html,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const message = error instanceof Error ? error.message : String(error);
    const timedOut = /timeout|aborted|UND_ERR_(HEADERS|BODY)_TIMEOUT/i.test(message);

    return {
      ...base,
      status: timedOut ? "TIMEOUT" : "FETCH_FAILED",
      httpStatus: null,
      latencyMs,
      error: timedOut ? `Timed out after ${timeoutMs}ms` : message.slice(0, 300),
    };
  }
}

async function readCapped(
  body: NodeJS.ReadableStream,
  maxBytes: number,
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of body) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buffer.length;
    if (total > maxBytes) {
      chunks.push(buffer.subarray(0, buffer.length - (total - maxBytes)));
      break;
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

/** Fetches a text resource (robots.txt, sitemap.xml). Null on any failure. */
export async function fetchText(
  url: string,
  timeoutMs: number = CAPS.FETCH_TIMEOUT_MS,
): Promise<string | null> {
  try {
    const response = await request(url, {
      method: "GET",
      headers: { "user-agent": USER_AGENT },
      dispatcher,
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
    });

    if (response.statusCode >= 400) {
      await response.body.dump();
      return null;
    }

    return await readCapped(response.body, MAX_BYTES);
  } catch {
    return null;
  }
}
