/**
 * Every tunable in Parity lives here. No magic numbers in the pipeline.
 * See PLAN.md §5 (model roles), §6 (scoring), §7 (caps and budgets).
 *
 * Model selection moved to lib/llm/models.ts when the panel became
 * mode-aware; search configuration lives in lib/search/.
 */

import type { FactCategory, Ruling, ScanMode } from "@prisma/client";

// ---------------------------------------------------------------- modes

export type ModeCaps = {
  maxPages: number;
  maxQuestions: number;
  maxPanelModels: number;
  /** Remediations generated, severity-ranked. */
  maxRemediations: number;
  /** Whether the BROWSING condition runs at all. */
  browsing: boolean;
};

/**
 * FREE is capped hard because it runs on the operator's free-tier keys and
 * is open to the public. BYOK is uncapped in spirit — the user is spending
 * their own quota — but still bounded by the crawl ceiling.
 */
export const MODE_CAPS: Record<ScanMode, ModeCaps> = {
  DEMO: {
    maxPages: 25,
    maxQuestions: 40,
    maxPanelModels: 2,
    maxRemediations: 12,
    browsing: true,
  },
  FREE: {
    maxPages: 5,
    maxQuestions: 8,
    maxPanelModels: 1,
    maxRemediations: 3,
    browsing: true,
  },
  BYOK: {
    maxPages: 25,
    maxQuestions: 40,
    maxPanelModels: 2,
    maxRemediations: 12,
    browsing: true,
  },
};

/** Public quota: scans per client per rolling window, for FREE mode only. */
export const FREE_QUOTA = {
  scansPerWindow: 3,
  windowMs: 60 * 60 * 1000,
} as const;

// ---------------------------------------------------------------- caps

export const CAPS = {
  /** Hard ceiling on pages fetched, regardless of mode. */
  MAX_PAGES: 25,
  /** Hard ceiling on questions, regardless of mode. */
  MAX_QUESTIONS: 40,
  /** Concurrent model calls during panel fan-out. */
  CONCURRENCY: 4,
  /** Facts handed to the adjudicator for a single answer. */
  LEDGER_SLICE: 25,
  /** Per-page fetch timeout. */
  FETCH_TIMEOUT_MS: 15_000,
  /** Search results retrieved per browsing question. */
  SEARCH_RESULTS: 4,

  /**
   * Minimum output-token budget for any call.
   *
   * Gemini 3.8 Flash always thinks, and `thinkingBudget: 0` is NOT honoured
   * on generateText — a one-word reply measured 81 reasoning tokens against
   * 1 text token. At a small budget it returns TRUNCATED GARBAGE with
   * finishReason "length" rather than an error, which would silently poison
   * a scan. Never go below this, and always treat finishReason "length" as
   * a real failure.
   *
   * generateObject is unaffected: structured calls came back with zero
   * reasoning tokens.
   */
  MIN_OUTPUT_TOKENS: 2_048,
  /**
   * Panel answers: prose only.
   *
   * MEASURED: reserving 3,072 here made Groq's 6,000 TPM the binding
   * constraint on the whole pipeline — roughly 1.5 answers per minute, and
   * 55% of a screening run was spent waiting. Real answers run a few hundred
   * tokens. The limiter reserves against this number, so an inflated budget
   * costs throughput directly.
   *
   * Safe to lower now that the Gemini model is flash-lite, which emits zero
   * reasoning tokens; the -flash models needed the headroom.
   *
   * HARD CEILING: Groq enforces output-tokens-per-minute separately from
   * total TPM, and the free tier allows 1,000. A request whose max_tokens
   * exceeds 1,000 is REJECTED OUTRIGHT — not throttled — with "Request too
   * large ... on output tokens per minute (OTPM)". So this must stay under
   * 1,000, and panel prompts must ask for brevity so answers finish inside
   * it rather than tripping the truncation guard.
   */
  ANSWER_OUTPUT_TOKENS: 900,
} as const;

/**
 * Wall-clock budget for a single phase request before it pauses and asks the
 * client to reconnect. Vercel Fluid caps a Hobby function at 300s; we stop
 * well short so the final work unit always has room to finish and commit.
 */
export const PHASE_BUDGET_MS = process.env.VERCEL ? 240_000 : 45_000;

// ---------------------------------------------------------------- scoring

/** Severity weight by fact category. Commercial harm ranks highest. */
export const CATEGORY_WEIGHT: Record<FactCategory, number> = {
  PRICING: 3,
  ELIGIBILITY: 3,
  LIMITS: 2,
  COMPATIBILITY: 2,
  API: 2,
  GENERAL: 1,
};

/**
 * Verdict scores.
 *
 * DRIFTED is -0.5, deliberately amending the original spec. At 0 it was
 * indistinguishable from UNSUPPORTED, which would collapse the two failure
 * modes Parity exists to separate: "your site is wrong" vs "your site is
 * invisible". Drift now sits below the neutral line; absence sits on it.
 */
export const RULING_SCORE: Record<Ruling, number> = {
  CONFIRMED: 1,
  DRIFTED: -0.5,
  UNSUPPORTED: 0,
  FABRICATED: -1,
};

/** The neutral midpoint. Above = models get you right, below = confidently wrong. */
export const NEUTRAL_SCORE = 50;

// ---------------------------------------------------------------- cache

/**
 * Bump to invalidate every cached model response at once — e.g. when the
 * live web has moved on far enough that browsing answers are stale.
 */
export const CACHE_NAMESPACE = process.env.LLM_CACHE_NAMESPACE ?? "v1";
