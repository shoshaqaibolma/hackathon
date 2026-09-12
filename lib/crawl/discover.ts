import { fetchPage, fetchText } from "@/lib/crawl/fetch";
import { extract } from "@/lib/crawl/extract";
import { canonicalise, isSameSite, type Candidate } from "@/lib/crawl/prioritise";
import { isAllowed, parseRobots, type RobotsRules } from "@/lib/crawl/robots";

/**
 * URL discovery: robots.txt, sitemaps, then homepage links.
 *
 * SCOPE DECISION: sitemap index files are followed one level deep and no
 * further, and sitemaps are parsed with a regex rather than an XML parser.
 * Sitemap XML is a fixed, trivial shape; a parser dependency buys nothing
 * on a 25-page crawl.
 */

export type Discovery = {
  candidates: Candidate[];
  robots: RobotsRules;
  /** Non-fatal problems, surfaced in the UI rather than swallowed. */
  warnings: string[];
  /** True when robots.txt forbids the site root outright. */
  blockedByRobots: boolean;
};

const MAX_SITEMAP_URLS = 500;
const MAX_SITEMAP_FILES = 5;

function extractTag(xml: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    out.push(match[1]);
  }
  return out;
}

function decodeXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

export function parseSitemap(xml: string): {
  urls: { loc: string; priority: number | null }[];
  nestedSitemaps: string[];
} {
  const nestedSitemaps: string[] = [];

  // A <sitemapindex> contains <sitemap><loc>, not page URLs.
  if (/<sitemapindex/i.test(xml)) {
    for (const block of extractTag(xml, "sitemap")) {
      const loc = extractTag(block, "loc")[0];
      if (loc) nestedSitemaps.push(decodeXml(loc));
    }
    return { urls: [], nestedSitemaps };
  }

  const urls: { loc: string; priority: number | null }[] = [];
  for (const block of extractTag(xml, "url")) {
    const loc = extractTag(block, "loc")[0];
    if (!loc) continue;
    const rawPriority = extractTag(block, "priority")[0];
    const priority = rawPriority ? Number.parseFloat(decodeXml(rawPriority)) : null;
    urls.push({
      loc: decodeXml(loc),
      priority: Number.isFinite(priority) ? priority : null,
    });
  }

  return { urls, nestedSitemaps };
}

export async function discover(domain: string): Promise<Discovery> {
  const origin = `https://${domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}`;
  const warnings: string[] = [];
  const candidates: Candidate[] = [];

  // --- robots.txt -------------------------------------------------------
  const robotsText = await fetchText(`${origin}/robots.txt`);
  const robots = robotsText ? parseRobots(robotsText) : { disallow: [], allow: [], sitemaps: [] };

  if (!robotsText) {
    warnings.push("No robots.txt found — proceeding, crawling conservatively.");
  }

  if (!isAllowed(robots, `${origin}/`)) {
    return { candidates: [], robots, warnings, blockedByRobots: true };
  }

  // --- sitemaps ---------------------------------------------------------
  const sitemapUrls = robots.sitemaps.length > 0 ? robots.sitemaps : [`${origin}/sitemap.xml`];
  let filesRead = 0;
  const queue = [...sitemapUrls];
  const visited = new Set<string>();

  while (queue.length > 0 && filesRead < MAX_SITEMAP_FILES) {
    const sitemapUrl = queue.shift();
    if (!sitemapUrl || visited.has(sitemapUrl)) continue;
    visited.add(sitemapUrl);

    const xml = await fetchText(sitemapUrl);
    filesRead += 1;
    if (!xml) continue;

    const { urls, nestedSitemaps } = parseSitemap(xml);

    // One level of index recursion, deliberately.
    for (const nested of nestedSitemaps.slice(0, MAX_SITEMAP_FILES)) {
      if (!visited.has(nested)) queue.push(nested);
    }

    for (const { loc, priority } of urls.slice(0, MAX_SITEMAP_URLS)) {
      candidates.push({ url: loc, fromSitemap: true, sitemapPriority: priority });
    }
  }

  if (candidates.length === 0) {
    warnings.push("No usable sitemap — discovering pages from homepage links.");
  }

  // --- homepage links ---------------------------------------------------
  // Always run: sitemaps routinely omit the pages that matter most.
  const home = await fetchPage(`${origin}/`);
  if (home.status === "OK" && home.html) {
    candidates.push({ url: `${origin}/`, fromSitemap: false });
    const { links } = extract(home.html, `${origin}/`);
    for (const link of links) {
      const url = canonicalise(link.href);
      if (!url || !isSameSite(url, domain)) continue;
      candidates.push({ url, fromSitemap: false, anchorText: link.anchorText });
    }
  } else {
    warnings.push(
      `Homepage could not be read (${home.error ?? home.status}) — discovery relies on the sitemap alone.`,
    );
  }

  // Respect robots on every candidate, not just the root.
  const allowed = candidates.filter((candidate) => isAllowed(robots, candidate.url));
  const blocked = candidates.length - allowed.length;
  if (blocked > 0) {
    warnings.push(`${blocked} URL(s) skipped because robots.txt disallows them.`);
  }

  return { candidates: allowed, robots, warnings, blockedByRobots: false };
}
