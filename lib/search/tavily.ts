import { request } from "undici";

import { scrubError } from "@/lib/llm/scrub";
import {
  RetrievedSnippetSchema,
  type SearchProvider,
  type SearchResult,
} from "@/lib/search/types";

/**
 * Tavily adapter for the BROWSING condition.
 *
 * We retrieve snippets ourselves and inject them into the prompt rather than
 * using provider-native grounding. Free-tier grounding quotas are unreliable,
 * but the real win is inspectability: every snippet the model saw is stored
 * on the answer and rendered in the drift card. A built-in search tool is a
 * black box, and "the model browsed and got it wrong" is a much weaker claim
 * than "here are the four sources it read".
 *
 * Used through raw fetch — no SDK dependency needed for one endpoint.
 */

const TAVILY_ENDPOINT = "https://api.tavily.com/search";

/**
 * Snippets are truncated hard. Groq's free tier allows ~6,000 tokens per
 * minute, so an untruncated browsing prompt would throttle the scan to a
 * crawl. Four snippets at 480 chars is roughly 550 tokens of context.
 */
export const SNIPPET_CHAR_LIMIT = 480;

type TavilyResult = {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  score?: unknown;
  published_date?: unknown;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function truncate(text: string, limit: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= limit) return collapsed;
  return `${collapsed.slice(0, limit - 1).trimEnd()}…`;
}

export class TavilySearchProvider implements SearchProvider {
  readonly name = "tavily";

  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs = 10_000,
  ) {}

  /**
   * Never throws. A failed search is a real, reportable state on the answer,
   * not an exception that aborts a scan half-finished.
   */
  async search(query: string, limit: number): Promise<SearchResult> {
    const started = Date.now();

    try {
      const response = await request(TAVILY_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          query,
          max_results: limit,
          search_depth: "basic",
          include_answer: false,
          include_raw_content: false,
        }),
        headersTimeout: this.timeoutMs,
        bodyTimeout: this.timeoutMs,
      });

      const latencyMs = Date.now() - started;

      if (response.statusCode < 200 || response.statusCode >= 300) {
        const body = await response.body.text();
        return {
          query,
          snippets: [],
          provider: this.name,
          latencyMs,
          error: `Search failed (HTTP ${response.statusCode}): ${scrub(body)}`,
        };
      }

      const payload = (await response.body.json()) as { results?: unknown };
      const rows = Array.isArray(payload.results) ? payload.results : [];

      const snippets = rows
        .slice(0, limit)
        .map((row) => {
          const r = row as TavilyResult;
          return RetrievedSnippetSchema.parse({
            title: asString(r.title) || asString(r.url),
            url: asString(r.url),
            snippet: truncate(asString(r.content), SNIPPET_CHAR_LIMIT),
            score: typeof r.score === "number" ? r.score : null,
            publishedAt: asString(r.published_date) || null,
          });
        })
        .filter((snippet) => snippet.url.length > 0);

      return { query, snippets, provider: this.name, latencyMs, error: null };
    } catch (error) {
      return {
        query,
        snippets: [],
        provider: this.name,
        latencyMs: Date.now() - started,
        error: scrubError(error, [this.apiKey]),
      };
    }
  }
}

function scrub(body: string): string {
  return scrubError(body).slice(0, 200);
}

/**
 * A provider that always returns an explicit "not configured" result.
 *
 * Used when TAVILY_API_KEY is absent, so the BROWSING condition degrades to
 * a visible, honest state instead of silently becoming MEMORY — which would
 * quietly invalidate the entire memory-vs-browsing diagnostic.
 */
export class UnconfiguredSearchProvider implements SearchProvider {
  readonly name = "none";

  async search(query: string): Promise<SearchResult> {
    return {
      query,
      snippets: [],
      provider: this.name,
      latencyMs: null,
      error:
        "No search provider configured (TAVILY_API_KEY unset), so the browsing condition could not run.",
    };
  }
}

export function getSearchProvider(): SearchProvider {
  const apiKey = process.env.TAVILY_API_KEY;
  return apiKey ? new TavilySearchProvider(apiKey) : new UnconfiguredSearchProvider();
}

export function isSearchConfigured(): boolean {
  return Boolean(process.env.TAVILY_API_KEY);
}
