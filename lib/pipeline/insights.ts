import { z } from "zod";

/**
 * Site insights — things Parity notices about a site that are findings in
 * their own right, not defects in the scan.
 *
 * Client-side rendering is the flagship case. It began life as an integrity
 * violation, which framed it as our limitation ("we couldn't read this
 * page"). That is backwards. A page that renders to almost nothing without
 * JavaScript is invisible to every text-based crawler, which includes the
 * retrieval layer behind most AI assistants. The customer needs to know that
 * far more urgently than they need to know a claim drifted.
 *
 * Worked example: github.com/pricing serves ~187 KB of HTML that extracts to
 * ~2,100 characters. It passes a naive length check. It is still mostly
 * invisible.
 */

export const InsightCodeValues = [
  "CLIENT_RENDERED",
  "THIN_CONTENT",
  "BLOCKED_BY_ROBOTS",
] as const;
export type InsightCode = (typeof InsightCodeValues)[number];

export const SiteInsightSchema = z.object({
  code: z.enum(InsightCodeValues),
  url: z.string(),
  /** One line, written for the site owner rather than for us. */
  headline: z.string(),
  detail: z.string(),
  /** Numbers behind the claim, so the finding is checkable. */
  evidence: z.record(z.string(), z.number()).default({}),
});
export type SiteInsight = z.infer<typeof SiteInsightSchema>;

/**
 * Extracted text as a share of raw HTML.
 *
 * A server-rendered content page typically lands well above 2%. A
 * single-page-app shell is almost all script and markup, and lands far below.
 */
export function textDensity(htmlBytes: number, textChars: number): number {
  if (htmlBytes <= 0) return 0;
  return textChars / htmlBytes;
}

/** Explicit markers of an unrendered app shell. */
const JS_SHELL_MARKERS = [
  "enable javascript",
  "javascript is required",
  "javascript is disabled",
  "please turn on javascript",
  "you need to enable javascript to run this app",
  "this application requires javascript",
];

export function hasJsShellMarker(text: string): boolean {
  const haystack = text.toLowerCase();
  return JS_SHELL_MARKERS.some((marker) => haystack.includes(marker));
}

/** Below this share of HTML, a page is substantially client-rendered. */
export const DENSITY_THRESHOLD = 0.02;
/** Pages smaller than this are too small for density to mean anything. */
const MIN_HTML_BYTES = 20_000;

export type PageSample = {
  url: string;
  htmlBytes: number;
  textChars: number;
  text: string;
  status: string;
};

/**
 * Derives insights from what the crawl saw.
 *
 * Deliberately conservative: a small page with little text is just a small
 * page, and only a large HTML payload that extracts to very little is
 * evidence of client rendering.
 */
export function deriveInsights(pages: readonly PageSample[]): SiteInsight[] {
  const insights: SiteInsight[] = [];

  for (const page of pages) {
    if (page.status === "BLOCKED_BY_ROBOTS") {
      insights.push({
        code: "BLOCKED_BY_ROBOTS",
        url: page.url,
        headline: "This page is closed to crawlers by robots.txt.",
        detail:
          "Assistants that respect robots.txt cannot read it, so anything stated only here cannot reach them.",
        evidence: {},
      });
      continue;
    }

    if (page.status !== "OK") continue;

    const explicit = hasJsShellMarker(page.text);
    const density = textDensity(page.htmlBytes, page.textChars);
    const thinForItsSize =
      page.htmlBytes >= MIN_HTML_BYTES && density < DENSITY_THRESHOLD;

    if (explicit || thinForItsSize) {
      insights.push({
        code: "CLIENT_RENDERED",
        url: page.url,
        headline: "This page is client-rendered and largely invisible to AI crawlers.",
        detail: explicit
          ? "The page states that JavaScript is required. Without a browser, a crawler sees the fallback message and nothing else — including the assistants that answer questions about you."
          : `${(page.htmlBytes / 1024).toFixed(0)} KB of HTML extracts to only ${page.textChars.toLocaleString("en-US")} characters of readable text (${(density * 100).toFixed(1)}%). Most of what a visitor sees is assembled in the browser, so text-based crawlers — including the retrieval layer behind most AI assistants — never see it.`,
        evidence: {
          htmlBytes: page.htmlBytes,
          textChars: page.textChars,
          densityPercent: Number((density * 100).toFixed(2)),
        },
      });
      continue;
    }

    // Genuinely thin content, as opposed to content hidden behind JavaScript.
    if (page.textChars < 300 && page.htmlBytes < MIN_HTML_BYTES) {
      insights.push({
        code: "THIN_CONTENT",
        url: page.url,
        headline: "This page has almost no readable content.",
        detail: `Only ${page.textChars} characters were extractable. There is little here for an assistant to cite about you.`,
        evidence: { textChars: page.textChars },
      });
    }
  }

  return insights;
}
