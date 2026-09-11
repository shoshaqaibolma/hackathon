/**
 * Every tunable in Parity lives here. No magic numbers in the pipeline.
 * See PLAN.md §5 (model roles), §6 (scoring), §7 (caps and budgets).
 */

import type { FactCategory, Ruling } from "@prisma/client";

// ---------------------------------------------------------------- models

/**
 * Model roles. Cost discipline: the strong model is used for adjudication
 * and nothing else.
 */
export const MODELS = {
  /** Extraction, question synthesis, claim decomposition. */
  FAST: "claude-haiku-4-5",
  /** Remediation copy — user-facing text, so a step up from FAST. */
  WRITER: "claude-sonnet-5",
  /** Adjudication only. Override with ADJUDICATOR_MODEL to cut cost. */
  JUDGE: process.env.ADJUDICATOR_MODEL ?? "claude-opus-5",
} as const;

export type PanelMember = {
  id: string;
  label: string;
  provider: "anthropic" | "openai";
};

/**
 * The models under test. Anthropic-only by default (decided at Phase 0).
 *
 * NOTE: a same-provider panel has correlated failure modes — see the
 * limitations section of README.md. The MEMORY vs BROWSING axis is
 * unaffected and carries the core signal.
 *
 * Setting PANEL_OPENAI_MODEL (plus OPENAI_API_KEY) adds a third,
 * cross-provider member without a code change.
 */
export function getPanel(): PanelMember[] {
  const panel: PanelMember[] = [
    { id: "claude-sonnet-5", label: "Claude Sonnet 5", provider: "anthropic" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "anthropic" },
  ];

  const openai = process.env.PANEL_OPENAI_MODEL;
  if (openai && process.env.OPENAI_API_KEY) {
    panel.push({ id: openai, label: openai, provider: "openai" });
  }

  return panel;
}

/**
 * Web search tool version.
 *
 * `web_search_20260209` adds dynamic filtering but requires Claude 4.6+,
 * because it runs the search from inside code execution. Haiku 4.5 predates
 * that and would 400. `web_search_20250305` defaults to direct calling and
 * works across the whole panel — and giving every panel member the identical
 * tool is the correct experimental design regardless.
 */
export const WEB_SEARCH_TOOL_VERSION = "web_search_20250305" as const;
export const WEB_SEARCH_MAX_USES = 5;

// ---------------------------------------------------------------- caps

export const CAPS = {
  /** Hard ceiling on pages fetched per scan. */
  MAX_PAGES: 25,
  /** Hard ceiling on questions per scan. */
  MAX_QUESTIONS: 40,
  /** Default question count — tuned for cost, raise toward MAX for a real audit. */
  DEFAULT_QUESTIONS: 24,
  /** Concurrent model calls during panel fan-out. */
  CONCURRENCY: 6,
  /** Facts handed to the adjudicator for a single answer. */
  LEDGER_SLICE: 25,
  /** Remediations generated per scan, severity-ranked. */
  MAX_REMEDIATIONS: 12,
  /** Per-page fetch timeout. */
  FETCH_TIMEOUT_MS: 15_000,
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
