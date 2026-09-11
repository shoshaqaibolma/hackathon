import { z } from "zod";

import { RetrievedSnippetSchema } from "@/lib/search/types";

/**
 * The single view model every renderer consumes.
 *
 * A DEMO fixture and a live database scan both map into `ScanView`, so the
 * judge path and the real product render through identical components and
 * cannot drift apart. The fixture file format IS a serialized ScanView plus
 * a version tag — see FixtureSchema at the bottom.
 */

// Kept as literal unions matching the Prisma enums. Duplicating them here is
// deliberate: fixtures are validated without a database or a generated client.
export const FactCategoryValues = [
  "PRICING",
  "ELIGIBILITY",
  "LIMITS",
  "COMPATIBILITY",
  "API",
  "GENERAL",
] as const;

export const RulingValues = [
  "CONFIRMED",
  "DRIFTED",
  "FABRICATED",
  "UNSUPPORTED",
] as const;

export const ConditionValues = ["MEMORY", "BROWSING"] as const;
export const ScanModeValues = ["DEMO", "FREE", "BYOK"] as const;
export const ProviderValues = ["GOOGLE", "GROQ", "ANTHROPIC", "OPENAI"] as const;

export const PageStatusValues = [
  "OK",
  "HTTP_ERROR",
  "BLOCKED_BY_ROBOTS",
  "EXTRACT_EMPTY",
  "TIMEOUT",
  "FETCH_FAILED",
] as const;

export const RemediationKindValues = ["LLMS_TXT", "JSON_LD", "PAGE_COPY"] as const;

// ---------------------------------------------------------------- pieces

export const FactViewSchema = z.object({
  id: z.string(),
  statement: z.string(),
  category: z.enum(FactCategoryValues),
  /** Verbatim quoted text from the page. Never paraphrased in the UI. */
  evidenceSpan: z.string(),
  sourceUrl: z.string(),
  pageTitle: z.string().nullable().default(null),
});
export type FactView = z.infer<typeof FactViewSchema>;

export const PageViewSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string().nullable().default(null),
  status: z.enum(PageStatusValues),
  httpStatus: z.number().nullable().default(null),
  error: z.string().nullable().default(null),
  factCount: z.number(),
  /** Facts whose evidence span could not be verified, and were dropped. */
  factsDropped: z.number().default(0),
});
export type PageView = z.infer<typeof PageViewSchema>;

export const QuestionViewSchema = z.object({
  id: z.string(),
  text: z.string(),
  category: z.enum(FactCategoryValues),
  targetFactIds: z.array(z.string()).default([]),
});
export type QuestionView = z.infer<typeof QuestionViewSchema>;

export const RemediationViewSchema = z.object({
  id: z.string(),
  kind: z.enum(RemediationKindValues),
  content: z.string(),
  targetUrl: z.string().nullable().default(null),
  rationale: z.string().nullable().default(null),
});
export type RemediationView = z.infer<typeof RemediationViewSchema>;

/**
 * The hero object. Everything one drift card needs, pre-joined — the
 * component does no lookups and no formatting decisions of its own.
 */
export const DriftCardSchema = z.object({
  id: z.string(),
  question: z.string(),
  questionCategory: z.enum(FactCategoryValues),

  model: z.string(),
  modelLabel: z.string(),
  provider: z.enum(ProviderValues),
  condition: z.enum(ConditionValues),
  latencyMs: z.number().nullable().default(null),

  /** The model's literal words. Rendered verbatim in the right pane. */
  claimText: z.string(),
  /** Surrounding answer text, for context under the claim. */
  answerExcerpt: z.string().nullable().default(null),

  ruling: z.enum(RulingValues),
  confidence: z.number(),
  reasoning: z.string(),
  /** True when validation downgraded this because the citation was invalid. */
  downgraded: z.boolean().default(false),

  /** Null for FABRICATED and UNSUPPORTED, which cite nothing. */
  groundTruth: FactViewSchema.nullable().default(null),
  evidenceQuote: z.string().nullable().default(null),

  /** BROWSING only: exactly what we retrieved and put in the prompt. */
  searchQuery: z.string().nullable().default(null),
  retrieval: z.array(RetrievedSnippetSchema).default([]),

  remediation: RemediationViewSchema.nullable().default(null),

  /** Severity weight this verdict carried into the score. */
  weight: z.number(),
});
export type DriftCard = z.infer<typeof DriftCardSchema>;

export const CompositionSchema = z.object({
  counts: z.record(z.enum(RulingValues), z.number()),
  weightShare: z.record(z.enum(RulingValues), z.number()),
  total: z.number(),
  totalWeight: z.number(),
});

export const RunViewSchema = z.object({
  id: z.string(),
  index: z.number(),
  label: z.string(),
  parityScore: z.number().nullable().default(null),
  composition: CompositionSchema,
  driftCards: z.array(DriftCardSchema).default([]),
  answerCount: z.number().default(0),
  /** Answers whose model call failed. Shown, never hidden. */
  failedAnswerCount: z.number().default(0),
  startedAt: z.string(),
  finishedAt: z.string().nullable().default(null),
});
export type RunView = z.infer<typeof RunViewSchema>;

/**
 * Per-model-call accounting. `cached` is the honesty column: a BYOK user
 * must be able to see which work was served from a previous scan's cache,
 * so nobody believes they paid for something already done.
 */
export const CostLineSchema = z.object({
  stage: z.string(),
  provider: z.enum(ProviderValues),
  model: z.string(),
  calls: z.number(),
  cachedCalls: z.number().default(0),
  inputTokens: z.number().nullable().default(null),
  outputTokens: z.number().nullable().default(null),
  /** Null for free-tier providers, where no price applies. */
  costUsd: z.number().nullable().default(null),
});
export type CostLine = z.infer<typeof CostLineSchema>;

export const CostBreakdownSchema = z.object({
  lines: z.array(CostLineSchema).default([]),
  totalCalls: z.number().default(0),
  cachedCalls: z.number().default(0),
  totalCostUsd: z.number().nullable().default(null),
});
export type CostBreakdown = z.infer<typeof CostBreakdownSchema>;

export const PanelMemberViewSchema = z.object({
  id: z.string(),
  label: z.string(),
  provider: z.enum(ProviderValues),
});

// ---------------------------------------------------------------- scan

export const ScanViewSchema = z.object({
  id: z.string(),
  domain: z.string(),
  mode: z.enum(ScanModeValues),
  status: z.string(),
  parityScore: z.number().nullable().default(null),
  /** How the score should be read aloud. */
  interpretation: z.string(),
  composition: CompositionSchema,

  warnings: z.array(z.string()).default([]),
  error: z.string().nullable().default(null),

  createdAt: z.string(),
  finishedAt: z.string().nullable().default(null),

  panel: z.array(PanelMemberViewSchema).default([]),
  pages: z.array(PageViewSchema).default([]),
  facts: z.array(FactViewSchema).default([]),
  questions: z.array(QuestionViewSchema).default([]),
  runs: z.array(RunViewSchema).default([]),
  remediations: z.array(RemediationViewSchema).default([]),
  cost: CostBreakdownSchema,
});
export type ScanView = z.infer<typeof ScanViewSchema>;

// ---------------------------------------------------------------- fixture

export const FIXTURE_VERSION = 1;

/**
 * The on-disk DEMO fixture. Read from the filesystem with no database and no
 * network, so /demo survives an outage, an exhausted quota, or a missing
 * DATABASE_URL. Recorded from a real scan by `pnpm demo:record` — never
 * hand-authored.
 */
export const FixtureSchema = ScanViewSchema.extend({
  fixtureVersion: z.literal(FIXTURE_VERSION),
  /** URL segment: /demo/<slug> */
  slug: z.string(),
  /** One line describing what this scan demonstrates. */
  headline: z.string(),
  recordedAt: z.string(),
});
export type Fixture = z.infer<typeof FixtureSchema>;
