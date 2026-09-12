import { locateSpan } from "@/lib/crawl/extract";

/**
 * Claim hygiene.
 *
 * Two failures were found in the first real screening run, and both would
 * have quietly corrupted every Parity Score:
 *
 * 1. HEDGES SCORED AS DRIFT. "I'm not sure what Tax Basic refers to" and
 *    "I cannot provide specific numbers" were extracted as claims and ruled
 *    DRIFTED. A refusal is not a wrong answer — it is the model not knowing
 *    the company, which is the UNSUPPORTED/invisible regime. Scoring it as
 *    drift pushes an invisible company below the neutral line and destroys
 *    the distinction the whole product rests on.
 *
 * 2. CORRECTED CLAIMS. One finding's claim text asserted the truth while its
 *    own note said the model had claimed the opposite — the extractor had
 *    silently rewritten the model's words into the correct answer. The drift
 *    card would then quote the model saying something it never said, which
 *    is both wrong and a publication-rule violation.
 *
 * Neither can be fixed by prompting alone. Both are checked here.
 */

/**
 * Phrases that mark a non-assertion. A claim is only checkable if the model
 * actually committed to something.
 */
const HEDGE_PATTERNS: RegExp[] = [
  /^\s*(i|we)\s+(am|'m|are|was)\s+not\s+(sure|certain|aware|familiar)/i,
  /^\s*(i|we)\s+(cannot|can't|can not|don't|do not|couldn't)\s+(provide|give|confirm|verify|say|access|find|determine|recall|know)/i,
  /^\s*(i|we)\s+(don't|do not)\s+have\s+(access|information|data|details|specific)/i,
  /^\s*(i|we)\s+(have\s+no|lack)\s+(information|knowledge|data|details)/i,
  /^\s*(it|this)\s+is\s+(unclear|not clear|uncertain)/i,
  /^\s*(there|i)\s+(is|are|have)\s+no\s+(public|publicly available|specific)\s+(information|data|details)/i,
  /^\s*as\s+of\s+my\s+(last\s+)?(knowledge\s+)?(update|cutoff|training)/i,
  /^\s*(please|you should|i recommend|i'd recommend|check|consult|visit|refer)\b/i,
  /^\s*(i|we)\s+(would|'d)\s+(need|suggest|recommend)/i,
  /^\s*(unfortunately|regrettably)\b/i,
];

/** Words that carry no distinguishing signal when comparing a claim to an answer. */
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "and",
  "or", "but", "of", "to", "in", "on", "for", "with", "at", "by", "from",
  "that", "this", "these", "those", "it", "its", "as", "not", "no", "there",
  "has", "have", "had", "do", "does", "did", "can", "could", "will", "would",
  "you", "your", "their", "they",
]);

export type ClaimVerification = "exact" | "paraphrase" | "unverified";

export type VerifiedClaim = {
  text: string;
  verification: ClaimVerification;
};

export type ClaimFilterResult = {
  claims: VerifiedClaim[];
  dropped: number;
  droppedReasons: string[];
};

/** True when the text is a refusal, a hedge, or advice rather than an assertion. */
export function isHedge(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return HEDGE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function distinctiveWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9%$.\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

/**
 * How much of the claim's substance actually appears in the answer.
 *
 * An exact locate is preferred. A high word overlap means the extractor
 * paraphrased, which is tolerable — the drift card renders the verbatim
 * answer excerpt alongside. Low overlap means the claim was invented or
 * inverted, and it is dropped.
 */
export function verifyClaim(answerText: string, claim: string): ClaimVerification {
  if (locateSpan(answerText, claim) !== -1) return "exact";

  const claimWords = distinctiveWords(claim);
  if (claimWords.length === 0) return "unverified";

  const answerWords = new Set(distinctiveWords(answerText));
  const matched = claimWords.filter((word) => answerWords.has(word)).length;

  return matched / claimWords.length >= 0.7 ? "paraphrase" : "unverified";
}

/**
 * Filters a model's decomposed claims down to those that are both checkable
 * and genuinely the model's own.
 */
export function filterClaims(
  answerText: string,
  claims: readonly string[],
): ClaimFilterResult {
  const kept: VerifiedClaim[] = [];
  const droppedReasons: string[] = [];
  const seen = new Set<string>();

  for (const raw of claims) {
    const text = raw.trim();
    if (!text) continue;

    if (isHedge(text)) {
      droppedReasons.push(`hedge, not an assertion: "${text.slice(0, 70)}"`);
      continue;
    }

    const verification = verifyClaim(answerText, text);
    if (verification === "unverified") {
      droppedReasons.push(
        `claim not found in the answer — possibly rewritten: "${text.slice(0, 70)}"`,
      );
      continue;
    }

    const key = text.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);

    kept.push({ text, verification });
  }

  return {
    claims: kept,
    dropped: claims.length - kept.length,
    droppedReasons,
  };
}

/**
 * An answer that is nothing but hedging is a real signal, not an error: the
 * model does not know this company. That is UNSUPPORTED — the invisible
 * regime — and must never be recorded as drift.
 */
export function isRefusal(answerText: string): boolean {
  const sentences = answerText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length === 0) return true;
  const hedges = sentences.filter(isHedge).length;
  return hedges / sentences.length >= 0.6;
}
