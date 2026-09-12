/**
 * Deterministic URL prioritisation.
 *
 * Pure and unit-tested: given the same candidate URLs, the crawl order is
 * always identical, so a scan is reproducible and the order is auditable
 * after the fact (Page.priority is persisted).
 *
 * SCOPE DECISION: the original plan had a model call break ties when no
 * sitemap exists. That is cut. Pattern scoring picks the pricing, docs and
 * FAQ pages perfectly well, and a model call here would add latency, cost
 * and non-determinism to the one part of the pipeline that does not need
 * judgement. The fact ledger is unaffected.
 */

export type Candidate = {
  url: string;
  /** True when the URL came from a sitemap rather than link discovery. */
  fromSitemap: boolean;
  /** Sitemap <priority>, when present. */
  sitemapPriority?: number | null;
  /** Link text that pointed here, used as a weak signal. */
  anchorText?: string | null;
};

export type ScoredCandidate = Candidate & {
  score: number;
  /** Why it scored what it did — surfaced in the crawl UI. */
  reasons: string[];
};

/**
 * Path patterns worth crawling, highest commercial value first. These mirror
 * the fact categories that carry the most severity weight: a wrong price
 * costs more than a wrong founding date, so pricing pages get crawled first
 * and are the most likely to survive a tight page cap.
 */
const PATH_SIGNALS: ReadonlyArray<{ pattern: RegExp; score: number; label: string }> = [
  { pattern: /\/(pricing|plans|price|cost)(\/|$|\?)/i, score: 100, label: "pricing" },
  { pattern: /\/(eligibility|who-?can|requirements|qualify)(\/|$|\?)/i, score: 90, label: "eligibility" },
  { pattern: /\/(limits|quotas|rate-?limits|usage)(\/|$|\?)/i, score: 80, label: "limits" },
  { pattern: /\/(api|developers?|reference)(\/|$|\?)/i, score: 70, label: "api" },
  { pattern: /\/(docs?|documentation|guides?)(\/|$|\?)/i, score: 60, label: "docs" },
  { pattern: /\/(faq|help|support|questions)(\/|$|\?)/i, score: 55, label: "faq" },
  { pattern: /\/(changelog|releases?|whats-?new|updates)(\/|$|\?)/i, score: 50, label: "changelog" },
  { pattern: /\/(compare|vs|alternatives?)(\/|$|\?)/i, score: 45, label: "comparison" },
  { pattern: /\/(features?|product|platform)(\/|$|\?)/i, score: 40, label: "product" },
  { pattern: /\/(integrations?|compatibility|supported)(\/|$|\?)/i, score: 40, label: "compatibility" },
  { pattern: /\/(about|company|team)(\/|$|\?)/i, score: 20, label: "about" },
  { pattern: /\/(security|compliance|trust|sla)(\/|$|\?)/i, score: 35, label: "trust" },
];

/**
 * Paths that are never worth a model call. Blog posts and legal boilerplate
 * generate facts nobody asks an assistant about, and they crowd out pricing.
 */
const EXCLUDE_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /\/(blog|news|press|article|post)s?\//i, label: "blog" },
  { pattern: /\/(privacy|terms|legal|cookie|gdpr|dpa)(-|\/|$)/i, label: "legal" },
  { pattern: /\/(login|signin|signup|register|account|dashboard|app)(\/|$)/i, label: "app" },
  { pattern: /\/(careers?|jobs?|hiring)(\/|$)/i, label: "careers" },
  { pattern: /\/(tag|category|author|archive)s?\//i, label: "taxonomy" },
  { pattern: /\.(pdf|zip|png|jpe?g|gif|svg|mp4|webm|css|js|xml|json|ico|woff2?)$/i, label: "asset" },
  { pattern: /\/(cdn-cgi|wp-admin|wp-content|_next|static|assets)\//i, label: "infrastructure" },
];

export function isExcluded(url: string): { excluded: boolean; label?: string } {
  for (const { pattern, label } of EXCLUDE_PATTERNS) {
    if (pattern.test(url)) return { excluded: true, label };
  }
  return { excluded: false };
}

function pathDepth(url: string): number {
  try {
    const { pathname } = new URL(url);
    return pathname.split("/").filter(Boolean).length;
  } catch {
    return 99;
  }
}

/**
 * True only for the root of the PRIMARY domain.
 *
 * Found by crawling tavily.com: every subdomain root (`community.`,
 * `chat-research.`) also has path "/", so a naive check handed each one the
 * homepage bonus. Two of five page slots went to single-page-app shells that
 * extracted zero characters.
 */
function isHomepage(url: string, domain?: string): boolean {
  try {
    const { pathname, hostname } = new URL(url);
    if (pathname !== "/" && pathname !== "") return false;
    if (!domain) return true;
    const host = hostname.toLowerCase().replace(/^www\./, "");
    return host === domain.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
}

/**
 * Subdomains that usually hold documentation are fine; the rest are
 * typically logged-in applications or forums whose content is rendered
 * client-side and yields nothing to a text-only crawler.
 */
const USEFUL_SUBDOMAINS = /^(docs?|developers?|help|support|api|learn|guides?)$/i;

function subdomainPenalty(url: string, domain?: string): { penalty: number; label?: string } {
  if (!domain) return { penalty: 0 };
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const root = domain.toLowerCase().replace(/^www\./, "");
    if (host === root) return { penalty: 0 };

    const label = host.slice(0, -(root.length + 1));
    if (USEFUL_SUBDOMAINS.test(label)) return { penalty: 0, label: `${label} subdomain` };
    return { penalty: 55, label: `${label} subdomain` };
  } catch {
    return { penalty: 0 };
  }
}

/**
 * Normalises for deduplication: strips the fragment, tracking parameters,
 * a trailing slash, and lowercases the host. Two URLs that fetch the same
 * bytes must not both consume a slot against the page cap.
 */
export function canonicalise(rawUrl: string, base?: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl, base);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  url.hash = "";
  url.hostname = url.hostname.toLowerCase();

  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|mc_|ref|source)/i.test(key)) {
      url.searchParams.delete(key);
    }
  }

  // Sort remaining params so ?a=1&b=2 and ?b=2&a=1 collapse together.
  url.searchParams.sort();

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}

/** True when `url` belongs to `domain` or a subdomain of it. */
export function isSameSite(url: string, domain: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const target = domain.toLowerCase().replace(/^www\./, "");
    return host === target || host.endsWith(`.${target}`);
  } catch {
    return false;
  }
}

export function scoreCandidate(
  candidate: Candidate,
  domain?: string,
): ScoredCandidate {
  const reasons: string[] = [];
  let score = 0;

  const excluded = isExcluded(candidate.url);
  if (excluded.excluded) {
    return {
      ...candidate,
      score: Number.NEGATIVE_INFINITY,
      reasons: [`excluded: ${excluded.label}`],
    };
  }

  for (const signal of PATH_SIGNALS) {
    if (signal.pattern.test(candidate.url)) {
      score += signal.score;
      reasons.push(signal.label);
      // Only the strongest path signal counts; /docs/api should not
      // out-rank /pricing by accumulating two medium signals.
      break;
    }
  }

  // The homepage almost always states the core value proposition and often
  // headline pricing, so it is always worth one slot.
  if (isHomepage(candidate.url, domain)) {
    score += 65;
    reasons.push("homepage");
  }

  const sub = subdomainPenalty(candidate.url, domain);
  if (sub.penalty > 0) {
    score -= sub.penalty;
    reasons.push(`deprioritised: ${sub.label}`);
  } else if (sub.label) {
    reasons.push(sub.label);
  }

  if (candidate.fromSitemap) {
    score += 10;
    reasons.push("sitemap");
  }

  if (typeof candidate.sitemapPriority === "number") {
    score += candidate.sitemapPriority * 10;
  }

  if (candidate.anchorText && /pricing|plans|cost|docs|api|faq/i.test(candidate.anchorText)) {
    score += 5;
    reasons.push("anchor");
  }

  // Shallow pages are more likely to be canonical overview pages.
  const depth = pathDepth(candidate.url);
  score -= depth * 4;

  return { ...candidate, score, reasons };
}

/**
 * Deduplicates, scores, and returns the top `limit` URLs in crawl order.
 *
 * Ties break on URL string so the result is stable across runs — a scan
 * must be reproducible, and an unstable sort would silently change which
 * pages make the cut.
 */
export function prioritise(
  candidates: readonly Candidate[],
  domain: string,
  limit: number,
): ScoredCandidate[] {
  const seen = new Map<string, Candidate>();

  for (const candidate of candidates) {
    const url = canonicalise(candidate.url);
    if (!url) continue;
    if (!isSameSite(url, domain)) continue;

    const existing = seen.get(url);
    if (existing) {
      // Prefer the richer record when the same URL arrives twice.
      seen.set(url, {
        url,
        fromSitemap: existing.fromSitemap || candidate.fromSitemap,
        sitemapPriority: existing.sitemapPriority ?? candidate.sitemapPriority,
        anchorText: existing.anchorText ?? candidate.anchorText,
      });
    } else {
      seen.set(url, { ...candidate, url });
    }
  }

  return [...seen.values()]
    .map((candidate) => scoreCandidate(candidate, domain))
    .filter((c) => c.score !== Number.NEGATIVE_INFINITY)
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
    .slice(0, limit);
}
