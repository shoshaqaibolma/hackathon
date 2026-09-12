import { z } from "zod";

import { FactCategoryValues, RulingValues } from "@/lib/view/types";

/**
 * Every structured model output in the pipeline.
 *
 * Schema NAMES are part of the LLM cache key, so renaming one deliberately
 * invalidates its cached responses. Keep the exported variable name and the
 * name string identical.
 */

export const FactBatchSchema = z.object({
  facts: z
    .array(
      z.object({
        statement: z
          .string()
          .describe(
            "One atomic, checkable fact stated by the page. Self-contained: a reader must not need the page to understand it.",
          ),
        category: z.enum(FactCategoryValues),
        evidenceSpan: z
          .string()
          .describe(
            "The EXACT text copied verbatim from the page that supports this fact. Must appear character-for-character in the source. Do not paraphrase, summarise, correct, or reformat.",
          ),
      }),
    )
    .describe("Facts worth checking. Prefer specific numbers, limits and prices."),
});
export const FactBatch = "FactBatch";
export type FactBatch = z.infer<typeof FactBatchSchema>;

export const QuestionBatchSchema = z.object({
  questions: z.array(
    z.object({
      text: z
        .string()
        .describe(
          "A question a prospective customer would actually ask an AI assistant about this company.",
        ),
      category: z.enum(FactCategoryValues),
      targetFactIndexes: z
        .array(z.number())
        .describe("Indexes of the supplied facts this question checks."),
    }),
  ),
});
export const QuestionBatch = "QuestionBatch";
export type QuestionBatch = z.infer<typeof QuestionBatchSchema>;

export const ClaimBatchSchema = z.object({
  claims: z
    .array(
      z
        .string()
        .describe(
          "One atomic factual assertion from the answer, quoted or closely paraphrased. Skip hedges, pleasantries and questions.",
        ),
    )
    .describe("Every checkable assertion the answer makes."),
});
export const ClaimBatch = "ClaimBatch";
export type ClaimBatch = z.infer<typeof ClaimBatchSchema>;

export const VerdictBatchSchema = z.object({
  verdicts: z.array(
    z.object({
      claimIndex: z.number(),
      ruling: z.enum(RulingValues),
      confidence: z.number().min(0).max(1),
      citedFactId: z
        .string()
        .nullable()
        .describe(
          "The id of the ledger fact this verdict relies on. REQUIRED for CONFIRMED and DRIFTED. Must be one of the ids supplied — never invent one. Null for FABRICATED and UNSUPPORTED.",
        ),
      evidenceQuote: z
        .string()
        .nullable()
        .describe("The exact span from the cited fact that decides this verdict."),
      reasoning: z.string().describe("One or two sentences. State the discrepancy."),
    }),
  ),
});
export const VerdictBatch = "VerdictBatch";
export type VerdictBatch = z.infer<typeof VerdictBatchSchema>;

/**
 * Screening-only: collapses claim decomposition and adjudication into one
 * call. Used by the candidate-scan script to rank domains cheaply. The
 * product pipeline keeps the two stages separate so each is inspectable.
 */
export const ScreeningSchema = z.object({
  findings: z.array(
    z.object({
      claim: z.string().describe("The model's assertion, in its own words."),
      ruling: z.enum(RulingValues),
      factIndex: z
        .number()
        .nullable()
        .describe("Index of the ledger fact relied on, or null."),
      note: z.string().describe("One sentence on the discrepancy."),
    }),
  ),
});
export const Screening = "Screening";
export type Screening = z.infer<typeof ScreeningSchema>;

export const RemediationPatchSchema = z.object({
  kind: z
    .enum(["LLMS_TXT", "JSON_LD", "PAGE_COPY"])
    .describe("The format that best fixes this particular error."),
  content: z
    .string()
    .describe(
      "The patch itself, ready to paste. Contains ONLY information already present in the supplied fact and its evidence text.",
    ),
  rationale: z
    .string()
    .describe("One sentence: why this format, and what it fixes."),
});
export const RemediationPatch = "RemediationPatch";
export type RemediationPatch = z.infer<typeof RemediationPatchSchema>;
