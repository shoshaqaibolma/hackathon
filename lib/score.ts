import type { FactCategory, Ruling } from "@prisma/client";

import { CATEGORY_WEIGHT, NEUTRAL_SCORE, RULING_SCORE } from "@/lib/config";

/**
 * The Parity Score. Pure, total, and unit-tested — this is the number the
 * whole product is judged on, so it lives in one function with no I/O.
 *
 *   weight: PRICING 3, ELIGIBILITY 3, LIMITS 2, COMPATIBILITY 2, API 2, GENERAL 1
 *   score:  CONFIRMED +1, DRIFTED -0.5, UNSUPPORTED 0, FABRICATED -1
 *   Parity = clamp(0, 100, 50 + 50 * Σ(weight × score) / Σ(weight))
 */

export type ScorableVerdict = {
  ruling: Ruling;
  /**
   * Category of the fact this verdict cited. Null for FABRICATED and
   * UNSUPPORTED, which by definition cite nothing.
   */
  citedFactCategory: FactCategory | null;
  /**
   * Category of the question that produced the claim. The fallback when no
   * fact was cited — see the weight resolution order below.
   */
  questionCategory: FactCategory | null;
};

/**
 * Severity weight for a single verdict.
 *
 * The published formula weights by *fact category*, but FABRICATED and
 * UNSUPPORTED verdicts have no fact to read a category from. Resolution order:
 *
 *   1. the cited fact's category
 *   2. the parent question's category (questions are synthesised from facts)
 *   3. GENERAL
 *
 * Without this, the highest-severity failure mode — a fabricated price —
 * would have no weight at all.
 */
export function weightFor(verdict: ScorableVerdict): number {
  const category =
    verdict.citedFactCategory ?? verdict.questionCategory ?? "GENERAL";
  return CATEGORY_WEIGHT[category];
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Returns null for an empty verdict set.
 *
 * "No data" is emphatically not "neutral": a scan that produced no verdicts
 * must not render as 50, which would read as "the models don't know you".
 * The UI is required to show the null state as its own thing.
 */
export function parityScore(verdicts: readonly ScorableVerdict[]): number | null {
  if (verdicts.length === 0) return null;

  let weighted = 0;
  let totalWeight = 0;

  for (const verdict of verdicts) {
    const weight = weightFor(verdict);
    weighted += weight * RULING_SCORE[verdict.ruling];
    totalWeight += weight;
  }

  // Every weight is >= 1, so totalWeight > 0 whenever the list is non-empty.
  if (totalWeight === 0) return null;

  return clamp(NEUTRAL_SCORE + NEUTRAL_SCORE * (weighted / totalWeight), 0, 100);
}

export type VerdictComposition = {
  counts: Record<Ruling, number>;
  /** Share of total weight, not of raw count — matches how the score is built. */
  weightShare: Record<Ruling, number>;
  total: number;
  totalWeight: number;
};

const EMPTY_COUNTS: Record<Ruling, number> = {
  CONFIRMED: 0,
  DRIFTED: 0,
  UNSUPPORTED: 0,
  FABRICATED: 0,
};

/**
 * Composition of the score, for the stacked bar that always sits beside it.
 *
 * A mid-range Parity Score is ambiguous on its own: 52 built from "mostly
 * confirmed, two fabrications" and 52 built from "nothing but drift" are
 * different products. Weight share, not count share, so the bar and the
 * number tell the same story.
 */
export function composition(
  verdicts: readonly ScorableVerdict[],
): VerdictComposition {
  const counts = { ...EMPTY_COUNTS };
  const weights = { ...EMPTY_COUNTS };
  let totalWeight = 0;

  for (const verdict of verdicts) {
    const weight = weightFor(verdict);
    counts[verdict.ruling] += 1;
    weights[verdict.ruling] += weight;
    totalWeight += weight;
  }

  const weightShare = { ...EMPTY_COUNTS };
  if (totalWeight > 0) {
    for (const ruling of Object.keys(weights) as Ruling[]) {
      weightShare[ruling] = weights[ruling] / totalWeight;
    }
  }

  return { counts, weightShare, total: verdicts.length, totalWeight };
}

/** How a score should be read aloud. Used verbatim in the dashboard. */
export function interpret(score: number | null): string {
  if (score === null) return "No verdicts yet — nothing to score.";
  if (score > 60) return "Models get you right.";
  if (score >= 40) return "Models don't really know you.";
  return "Models are confidently wrong about you.";
}

export type WrongShare = {
  /** Claims ruled DRIFTED or FABRICATED. */
  wrong: number;
  /** Claims that were checkable at all — excludes UNSUPPORTED. */
  checkable: number;
  /** wrong / checkable, or null when nothing was checkable. */
  share: number | null;
};

/**
 * The headline number: what share of checkable claims were wrong.
 *
 * The Parity Score remains the weighted aggregate, but its ceiling is set by
 * ledger coverage rather than by model accuracy. Notion scored 68.2 with a
 * perfect record, because UNSUPPORTED findings drag toward the midpoint —
 * which understates a good result and invites "so why can nobody score 90?".
 *
 * This has no such problem. UNSUPPORTED means the site never addressed the
 * claim, so it is excluded from the denominator entirely: this measures only
 * claims the ledger could actually adjudicate.
 */
export function wrongShare(verdicts: readonly ScorableVerdict[]): WrongShare {
  let wrong = 0;
  let checkable = 0;

  for (const verdict of verdicts) {
    if (verdict.ruling === "UNSUPPORTED") continue;
    checkable += 1;
    if (verdict.ruling === "DRIFTED" || verdict.ruling === "FABRICATED") wrong += 1;
  }

  return { wrong, checkable, share: checkable > 0 ? wrong / checkable : null };
}

/** How the headline number should be read aloud. */
export function interpretWrongShare(result: WrongShare): string {
  if (result.share === null) {
    return "Nothing the models said could be checked against your site.";
  }
  const pct = Math.round(result.share * 100);
  if (pct === 0) {
    return `Every one of the ${result.checkable} checkable claims was correct.`;
  }
  return `${result.wrong} of ${result.checkable} checkable claims about you were wrong.`;
}
