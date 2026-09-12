/**
 * Question hygiene.
 *
 * A synthesised question MUST name the company. This sounds obvious and was
 * wrong in the first screening run across all eleven domains: the prompt said
 * "do not name or quote the facts", and the model generalised that to not
 * naming the company either. Questions came out as "How far back can I
 * recover previous versions of my document on the free plan?" — no subject
 * at all.
 *
 * The panel then answered, entirely reasonably, "I need to know which
 * specific service you are asking about", and the adjudicator scored that
 * FABRICATED. Every domain looked like it was drifting badly. The scores
 * were measuring prompt ambiguity, not model knowledge.
 *
 * A real customer asking an assistant always names the company. So this is
 * both the honest framing and the one that produces a meaningful score.
 */

const TLD_PATTERN =
  /\.(com|io|so|ai|dev|app|net|org|co|sh|cloud|tech|xyz|me|to|gg)$/i;

/**
 * Recognisable name tokens for a domain.
 * "planetscale.com" -> ["planetscale"], "fly.io" -> ["fly"]
 */
export function brandTokens(domain: string): string[] {
  const host = domain
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .toLowerCase();

  const withoutTld = host.replace(TLD_PATTERN, "");
  const parts = withoutTld.split(".").filter(Boolean);

  // Prefer the most specific label: docs.example.com -> "example"
  const primary = parts.at(-1) ?? withoutTld;
  const tokens = new Set<string>([primary]);

  // Hyphenated names should also match their unhyphenated form.
  if (primary.includes("-")) tokens.add(primary.replace(/-/g, ""));

  return [...tokens].filter((token) => token.length >= 2);
}

/** True when the question identifies the company it is about. */
export function mentionsBrand(question: string, domain: string): boolean {
  const haystack = question.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  return brandTokens(domain).some((token) =>
    haystack.includes(token.toLowerCase()),
  );
}

/** Company name for prompts: "planetscale.com" -> "Planetscale". */
export function displayName(domain: string): string {
  const token = brandTokens(domain)[0] ?? domain;
  return token.charAt(0).toUpperCase() + token.slice(1);
}

export type QuestionFilterResult = {
  questions: string[];
  /** Questions rewritten to name the company. */
  repaired: number;
  dropped: number;
  droppedReasons: string[];
};

/** Question openers that stay grammatical after "In <Brand>, ". */
const SAFE_OPENERS =
  /^(what|how|are|is|can|could|does|do|will|would|which|when|where|why|if|should|has|have|am)\b/i;

/**
 * Rewrites a question to name the company.
 *
 * Dropping was tried first and is wrong in practice: gemini-3.1-flash-lite
 * ignores the instruction reliably enough that Notion and GitHub lost every
 * question and produced no score at all. Prefixing reads naturally — "In
 * Notion, how far back can I recover previous versions?" is a question a
 * real customer would ask, which is the bar the drift card has to meet.
 *
 * Returns null when no grammatical repair is available.
 */
export function repairQuestion(question: string, domain: string): string | null {
  const text = question.trim();
  if (!text) return null;
  if (mentionsBrand(text, domain)) return text;
  if (!SAFE_OPENERS.test(text)) return null;

  // Lower-case the original opener so the prefix reads as one sentence.
  const body = text.charAt(0).toLowerCase() + text.slice(1);
  return `In ${displayName(domain)}, ${body}`;
}

/**
 * Ensures every question names the company, repairing where possible and
 * dropping only what cannot be repaired grammatically.
 */
export function filterQuestions(
  questions: readonly string[],
  domain: string,
): QuestionFilterResult {
  const kept: string[] = [];
  const droppedReasons: string[] = [];
  const seen = new Set<string>();
  let repaired = 0;

  for (const raw of questions) {
    const text = raw.trim();
    if (!text) continue;

    let final = text;
    if (!mentionsBrand(text, domain)) {
      const fixed = repairQuestion(text, domain);
      if (!fixed) {
        droppedReasons.push(
          `question does not name the company and cannot be repaired: "${text.slice(0, 70)}"`,
        );
        continue;
      }
      final = fixed;
      repaired += 1;
    }

    const key = final.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);

    kept.push(final);
  }

  return {
    questions: kept,
    repaired,
    dropped: questions.length - kept.length,
    droppedReasons,
  };
}
