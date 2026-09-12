import { describe, expect, it } from "vitest";

import {
  canonicalise,
  isExcluded,
  isLocalePrefixed,
  isSameSite,
  prioritise,
  scoreCandidate,
  type Candidate,
} from "@/lib/crawl/prioritise";

function candidate(url: string, over: Partial<Candidate> = {}): Candidate {
  return { url, fromSitemap: false, ...over };
}

describe("canonicalise", () => {
  it("strips fragments, tracking params, and trailing slashes", () => {
    expect(canonicalise("https://Example.com/pricing/#plans?x=1")).toBe(
      "https://example.com/pricing",
    );
    expect(canonicalise("https://example.com/a?utm_source=x&gclid=y")).toBe(
      "https://example.com/a",
    );
  });

  it("collapses parameter order so one page takes one slot", () => {
    expect(canonicalise("https://example.com/a?b=2&a=1")).toBe(
      canonicalise("https://example.com/a?a=1&b=2"),
    );
  });

  it("keeps meaningful query parameters", () => {
    expect(canonicalise("https://example.com/docs?page=2")).toContain("page=2");
  });

  it("resolves relative URLs against a base", () => {
    expect(canonicalise("/pricing", "https://example.com/about")).toBe(
      "https://example.com/pricing",
    );
  });

  it("rejects non-http schemes and junk", () => {
    expect(canonicalise("mailto:hi@example.com")).toBeNull();
    expect(canonicalise("javascript:alert(1)")).toBeNull();
    expect(canonicalise("not a url")).toBeNull();
  });

  it("preserves the root path", () => {
    expect(canonicalise("https://example.com/")).toBe("https://example.com/");
  });
});

describe("isSameSite", () => {
  it("accepts the domain and its subdomains", () => {
    expect(isSameSite("https://example.com/a", "example.com")).toBe(true);
    expect(isSameSite("https://docs.example.com/a", "example.com")).toBe(true);
    expect(isSameSite("https://www.example.com/a", "example.com")).toBe(true);
  });

  it("rejects other sites, including lookalikes", () => {
    expect(isSameSite("https://evil.com/a", "example.com")).toBe(false);
    // The classic suffix-matching bug: notexample.com must not pass.
    expect(isSameSite("https://notexample.com/a", "example.com")).toBe(false);
    expect(isSameSite("https://example.com.evil.com/a", "example.com")).toBe(false);
  });
});

describe("isExcluded", () => {
  it("excludes blogs, legal pages, app routes, and assets", () => {
    for (const url of [
      "https://example.com/blog/hello",
      "https://example.com/privacy-policy",
      "https://example.com/terms",
      "https://example.com/login",
      "https://example.com/careers",
      "https://example.com/logo.png",
      "https://example.com/_next/static/x.js",
    ]) {
      expect(isExcluded(url).excluded, url).toBe(true);
    }
  });

  it("does not exclude real content pages", () => {
    for (const url of [
      "https://example.com/pricing",
      "https://example.com/docs/api",
      "https://example.com/faq",
      "https://example.com/",
    ]) {
      expect(isExcluded(url).excluded, url).toBe(false);
    }
  });
});

describe("scoreCandidate", () => {
  it("ranks pricing above docs above about", () => {
    const pricing = scoreCandidate(candidate("https://example.com/pricing"));
    const docs = scoreCandidate(candidate("https://example.com/docs"));
    const about = scoreCandidate(candidate("https://example.com/about"));

    expect(pricing.score).toBeGreaterThan(docs.score);
    expect(docs.score).toBeGreaterThan(about.score);
  });

  it("explains itself", () => {
    expect(scoreCandidate(candidate("https://example.com/pricing")).reasons).toContain(
      "pricing",
    );
  });

  it("counts only the strongest path signal", () => {
    // /docs/api must not beat /pricing by stacking two medium signals.
    const combined = scoreCandidate(candidate("https://example.com/docs/api"));
    const pricing = scoreCandidate(candidate("https://example.com/pricing"));
    expect(pricing.score).toBeGreaterThan(combined.score);
  });

  it("always values the homepage", () => {
    const home = scoreCandidate(candidate("https://example.com/"));
    expect(home.reasons).toContain("homepage");
    expect(home.score).toBeGreaterThan(
      scoreCandidate(candidate("https://example.com/about")).score,
    );
  });

  it("penalises depth", () => {
    const shallow = scoreCandidate(candidate("https://example.com/docs"));
    const deep = scoreCandidate(candidate("https://example.com/docs/a/b/c/d"));
    expect(shallow.score).toBeGreaterThan(deep.score);
  });

  it("rewards sitemap membership and priority", () => {
    const plain = scoreCandidate(candidate("https://example.com/features"));
    const mapped = scoreCandidate(
      candidate("https://example.com/features", {
        fromSitemap: true,
        sitemapPriority: 1,
      }),
    );
    expect(mapped.score).toBeGreaterThan(plain.score);
  });

  it("marks excluded URLs as unrankable rather than merely low", () => {
    const blog = scoreCandidate(candidate("https://example.com/blog/post"));
    expect(blog.score).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe("prioritise", () => {
  const domain = "example.com";

  it("deduplicates URLs that differ only cosmetically", () => {
    const result = prioritise(
      [
        candidate("https://example.com/pricing"),
        candidate("https://example.com/pricing/"),
        candidate("https://example.com/pricing#plans"),
        candidate("https://example.com/pricing?utm_source=x"),
      ],
      domain,
      10,
    );
    expect(result).toHaveLength(1);
  });

  it("drops off-site and excluded URLs", () => {
    const result = prioritise(
      [
        candidate("https://example.com/pricing"),
        candidate("https://evil.com/pricing"),
        candidate("https://example.com/blog/post"),
      ],
      domain,
      10,
    );
    expect(result.map((r) => r.url)).toEqual(["https://example.com/pricing"]);
  });

  it("honours the page cap, keeping the most valuable pages", () => {
    const result = prioritise(
      [
        candidate("https://example.com/about"),
        candidate("https://example.com/pricing"),
        candidate("https://example.com/docs"),
        candidate("https://example.com/faq"),
      ],
      domain,
      2,
    );
    expect(result).toHaveLength(2);
    expect(result[0].url).toBe("https://example.com/pricing");
  });

  it("is deterministic — identical input gives identical order", () => {
    const input = [
      candidate("https://example.com/b"),
      candidate("https://example.com/a"),
      candidate("https://example.com/pricing"),
      candidate("https://example.com/docs"),
    ];
    const first = prioritise(input, domain, 10).map((r) => r.url);
    const second = prioritise([...input].reverse(), domain, 10).map((r) => r.url);
    expect(first).toEqual(second);
  });

  it("merges sitemap metadata when the same URL arrives twice", () => {
    const result = prioritise(
      [
        candidate("https://example.com/features"),
        candidate("https://example.com/features", {
          fromSitemap: true,
          sitemapPriority: 0.9,
        }),
      ],
      domain,
      10,
    );
    expect(result).toHaveLength(1);
    expect(result[0].reasons).toContain("sitemap");
  });

  it("returns an empty list rather than throwing on garbage input", () => {
    expect(prioritise([candidate("not a url")], domain, 10)).toEqual([]);
    expect(prioritise([], domain, 10)).toEqual([]);
  });

  it("puts a realistic site in a sensible order", () => {
    const result = prioritise(
      [
        candidate("https://example.com/"),
        candidate("https://example.com/blog/launch"),
        candidate("https://example.com/pricing"),
        candidate("https://example.com/docs/api/reference"),
        candidate("https://example.com/faq"),
        candidate("https://example.com/terms"),
        candidate("https://example.com/about"),
      ],
      domain,
      5,
    );

    expect(result[0].url).toBe("https://example.com/pricing");
    expect(result.map((r) => r.url)).not.toContain("https://example.com/terms");
    expect(result.map((r) => r.url)).not.toContain("https://example.com/blog/launch");
  });
});

describe("subdomain handling (regression from a real tavily.com crawl)", () => {
  const domain = "example.com";

  it("gives the homepage bonus only to the primary domain root", () => {
    // Every subdomain root also has path "/", which handed each of them the
    // homepage bonus and burned crawl slots on app shells.
    const primary = scoreCandidate(candidate("https://example.com/"), domain);
    const sub = scoreCandidate(candidate("https://community.example.com/"), domain);

    expect(primary.reasons).toContain("homepage");
    expect(sub.reasons).not.toContain("homepage");
    expect(primary.score).toBeGreaterThan(sub.score);
  });

  it("deprioritises app-like subdomains", () => {
    const app = scoreCandidate(candidate("https://chat-research.example.com/"), domain);
    expect(app.reasons.some((r) => r.startsWith("deprioritised"))).toBe(true);
  });

  it("does not penalise documentation subdomains", () => {
    const docs = scoreCandidate(candidate("https://docs.example.com/"), domain);
    expect(docs.reasons.some((r) => r.startsWith("deprioritised"))).toBe(false);
  });

  it("keeps real content pages ahead of subdomain roots", () => {
    const result = prioritise(
      [
        candidate("https://community.example.com/"),
        candidate("https://chat.example.com/"),
        candidate("https://example.com/pricing"),
        candidate("https://example.com/faq"),
        candidate("https://example.com/"),
      ],
      domain,
      3,
    );
    expect(result.map((r) => r.url)).toEqual([
      "https://example.com/pricing",
      "https://example.com/",
      "https://example.com/faq",
    ]);
  });
});

describe("localised duplicates (regression from a real dropbox.com crawl)", () => {
  it("excludes region-suffixed locale prefixes", () => {
    // /business/pricing, /de/business/pricing and /es_ES/business/pricing are
    // one page. All three were crawled; the ledger looked perfectly normal.
    expect(isLocalePrefixed("https://www.dropbox.com/es_ES/business/pricing")).toBe(true);
    expect(isLocalePrefixed("https://www.dropbox.com/pt-BR/business/pricing")).toBe(true);
  });

  it("excludes bare language-code prefixes", () => {
    expect(isLocalePrefixed("https://www.dropbox.com/de/business/pricing")).toBe(true);
    expect(isLocalePrefixed("https://example.com/ja/pricing")).toBe(true);
  });

  it("keeps English and region-suffixed English", () => {
    expect(isLocalePrefixed("https://example.com/en_GB/pricing")).toBe(false);
    expect(isLocalePrefixed("https://example.com/pricing")).toBe(false);
  });

  it("does not mistake a product path for a locale", () => {
    // Two-letter product segments are common and must survive.
    expect(isLocalePrefixed("https://example.com/go/pricing")).toBe(false);
    expect(isLocalePrefixed("https://example.com/ai/pricing")).toBe(false);
    expect(isLocalePrefixed("https://example.com/ui")).toBe(false);
  });

  it("leaves only the canonical page after prioritisation", () => {
    const result = prioritise(
      [
        candidate("https://dropbox.com/business/pricing"),
        candidate("https://dropbox.com/de/business/pricing"),
        candidate("https://dropbox.com/es_ES/business/pricing"),
        candidate("https://dropbox.com/fr/business/pricing"),
      ],
      "dropbox.com",
      10,
    );
    expect(result.map((r) => r.url)).toEqual([
      "https://dropbox.com/business/pricing",
    ]);
  });
});
