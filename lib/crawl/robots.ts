/**
 * Minimal robots.txt handling.
 *
 * SCOPE DECISION: this is prefix matching over Disallow/Allow rules for our
 * own user-agent group, not a full REP grammar. No crawl-delay scheduling,
 * no wildcard expansion beyond `*` and `$`. That is enough to respect a
 * site's wishes on a 25-page crawl, and the sophistication we skipped does
 * not change a single extracted fact.
 *
 * We err toward NOT crawling: an ambiguous or unparseable rule blocks.
 */

export type RobotsRules = {
  disallow: string[];
  allow: string[];
  sitemaps: string[];
};

export const USER_AGENT =
  "ParityBot/0.1 (+https://github.com/parity; AI answer-correctness auditing)";

const AGENT_TOKENS = ["paritybot", "*"];

export function parseRobots(text: string): RobotsRules {
  const rules: RobotsRules = { disallow: [], allow: [], sitemaps: [] };

  // Groups accumulate across consecutive User-agent lines, per the standard.
  let activeGroupApplies = false;
  let previousLineWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;

    const separator = line.indexOf(":");
    if (separator === -1) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    // Sitemap is group-independent.
    if (field === "sitemap") {
      if (value) rules.sitemaps.push(value);
      continue;
    }

    if (field === "user-agent") {
      const agent = value.toLowerCase();
      if (!previousLineWasAgent) activeGroupApplies = false;
      if (AGENT_TOKENS.includes(agent)) activeGroupApplies = true;
      previousLineWasAgent = true;
      continue;
    }

    previousLineWasAgent = false;
    if (!activeGroupApplies) continue;

    if (field === "disallow" && value) rules.disallow.push(value);
    if (field === "allow" && value) rules.allow.push(value);
  }

  return rules;
}

/** Converts a robots path pattern into a matcher supporting `*` and `$`. */
function matches(pattern: string, path: string): boolean {
  const anchoredEnd = pattern.endsWith("$");
  const body = anchoredEnd ? pattern.slice(0, -1) : pattern;

  const segments = body.split("*");
  let index = 0;

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (segment === "") continue;

    const found = i === 0 ? (path.startsWith(segment) ? 0 : -1) : path.indexOf(segment, index);
    if (found === -1) return false;
    index = found + segment.length;
  }

  if (anchoredEnd) return index === path.length;
  return true;
}

/**
 * Longest matching rule wins, Allow beating Disallow at equal length —
 * which is the behaviour every major crawler implements.
 */
export function isAllowed(rules: RobotsRules, url: string): boolean {
  let path: string;
  try {
    const parsed = new URL(url);
    path = `${parsed.pathname}${parsed.search}`;
  } catch {
    return false;
  }

  let bestDisallow = -1;
  let bestAllow = -1;

  for (const rule of rules.disallow) {
    if (matches(rule, path)) bestDisallow = Math.max(bestDisallow, rule.length);
  }
  for (const rule of rules.allow) {
    if (matches(rule, path)) bestAllow = Math.max(bestAllow, rule.length);
  }

  if (bestDisallow === -1) return true;
  return bestAllow >= bestDisallow;
}
