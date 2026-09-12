import { describe, expect, it } from "vitest";

import { isAllowed, parseRobots } from "@/lib/crawl/robots";

describe("parseRobots", () => {
  it("reads rules from the wildcard group", () => {
    const rules = parseRobots(`
User-agent: *
Disallow: /admin
Allow: /admin/public
Sitemap: https://example.com/sitemap.xml
`);
    expect(rules.disallow).toEqual(["/admin"]);
    expect(rules.allow).toEqual(["/admin/public"]);
    expect(rules.sitemaps).toEqual(["https://example.com/sitemap.xml"]);
  });

  it("ignores groups aimed at other crawlers", () => {
    const rules = parseRobots(`
User-agent: GPTBot
Disallow: /

User-agent: *
Disallow: /private
`);
    expect(rules.disallow).toEqual(["/private"]);
  });

  it("honours a group naming us specifically", () => {
    const rules = parseRobots(`
User-agent: ParityBot
Disallow: /nope
`);
    expect(rules.disallow).toEqual(["/nope"]);
  });

  it("applies rules to consecutive user-agent lines as one group", () => {
    const rules = parseRobots(`
User-agent: SomeBot
User-agent: *
Disallow: /shared
`);
    expect(rules.disallow).toEqual(["/shared"]);
  });

  it("strips comments and tolerates blank lines and junk", () => {
    const rules = parseRobots(`
# a comment
User-agent: *   # trailing
Disallow: /x    # inline

garbage line without a colon
`);
    expect(rules.disallow).toEqual(["/x"]);
  });

  it("collects sitemaps regardless of group", () => {
    const rules = parseRobots(`
Sitemap: https://example.com/a.xml
User-agent: OtherBot
Sitemap: https://example.com/b.xml
`);
    expect(rules.sitemaps).toHaveLength(2);
  });

  it("returns empty rules for an empty file", () => {
    expect(parseRobots("")).toEqual({ disallow: [], allow: [], sitemaps: [] });
  });
});

describe("isAllowed", () => {
  const rules = parseRobots(`
User-agent: *
Disallow: /admin
Allow: /admin/public
Disallow: /*.json$
Disallow: /search?
`);

  it("allows paths no rule covers", () => {
    expect(isAllowed(rules, "https://example.com/pricing")).toBe(true);
  });

  it("blocks a disallowed prefix", () => {
    expect(isAllowed(rules, "https://example.com/admin")).toBe(false);
    expect(isAllowed(rules, "https://example.com/admin/secret")).toBe(false);
  });

  it("lets a longer Allow override a shorter Disallow", () => {
    expect(isAllowed(rules, "https://example.com/admin/public/page")).toBe(true);
  });

  it("supports the $ end anchor", () => {
    expect(isAllowed(rules, "https://example.com/data.json")).toBe(false);
    // Anchored rule must not match when something follows.
    expect(isAllowed(rules, "https://example.com/data.json.html")).toBe(true);
  });

  it("supports * wildcards", () => {
    expect(isAllowed(rules, "https://example.com/deep/path/file.json")).toBe(false);
  });

  it("matches against the query string too", () => {
    expect(isAllowed(rules, "https://example.com/search?q=x")).toBe(false);
  });

  it("blocks everything under a bare Disallow: /", () => {
    const closed = parseRobots("User-agent: *\nDisallow: /");
    expect(isAllowed(closed, "https://example.com/")).toBe(false);
    expect(isAllowed(closed, "https://example.com/pricing")).toBe(false);
  });

  it("allows everything when robots.txt is empty", () => {
    expect(isAllowed(parseRobots(""), "https://example.com/anything")).toBe(true);
  });

  it("refuses a malformed URL rather than assuming it is fine", () => {
    expect(isAllowed(rules, "not a url")).toBe(false);
  });
});
