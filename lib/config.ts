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
