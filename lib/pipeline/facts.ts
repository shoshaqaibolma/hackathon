import type { FactCategory } from "@prisma/client";

import { locateSpan } from "@/lib/crawl/extract";
import { callObject, type CallRecord } from "@/lib/llm/call";
import { fastModelFor } from "@/lib/llm/models";
import { FactBatch, FactBatchSchema } from "@/lib/schemas";
import type { CallContext } from "@/lib/llm/call";

/**
 * Fact extraction with a mechanically enforced evidence invariant.
 *
 * The prompt asks for verbatim spans. Models comply most of the time and
 * silently paraphrase the rest of the time, which is exactly the failure this
 * product exists to catch elsewhere — so it is not enough to ask. Every span
 * is re-located in the source text before the fact is allowed to exist.
 *
 * A fact whose span cannot be found is DROPPED and counted. It is never
 * stored with a repaired, approximate, or model-supplied span.
 */

export type ExtractedFact = {
  statement: string;
  category: FactCategory;
  evidenceSpan: string;
  /** Offset into the source text. Always >= 0 for a returned fact. */
  evidenceOffset: number;
};

export type FactExtractionResult = {
  facts: ExtractedFact[];
  /** Facts the model proposed whose span could not be verified. */
  dropped: number;
  /** What was dropped and why — surfaced in the ledger UI. */
  droppedReasons: string[];
  records: CallRecord[];
};

const SYSTEM = `You extract atomic, checkable facts from a company's own web page.

Rules:
- Only state what the page itself says. Never use outside knowledge.
- Prefer facts a customer would verify before buying: prices, plan limits,
  quotas, eligibility, supported platforms, API constraints, deprecations.
- Each fact must be self-contained and understandable without the page.
- evidenceSpan must be copied CHARACTER FOR CHARACTER from the page text.
  Do not fix typos, expand abbreviations, change quotes, or join lines.
  If you cannot copy an exact span, omit the fact entirely.
- Skip navigation, cookie notices, legal boilerplate and marketing adjectives.

Categories: PRICING, ELIGIBILITY, LIMITS, COMPATIBILITY, API, GENERAL.`;

/** Pages are truncated so one enormous doc page cannot blow the token budget. */
const MAX_PAGE_CHARS = 12_000;

export async function extractFacts(
  pageText: string,
  url: string,
  context: CallContext,
  maxFacts = 12,
): Promise<FactExtractionResult> {
  const source = pageText.slice(0, MAX_PAGE_CHARS);

  const prompt = `Page URL: ${url}

Extract up to ${maxFacts} checkable facts from the page text below.

--- PAGE TEXT ---
${source}
--- END PAGE TEXT ---`;

  const { value, record } = await callObject(
    fastModelFor(context.credential ?? null),
    FactBatchSchema,
    FactBatch,
    SYSTEM,
    prompt,
    context,
  );

  const facts: ExtractedFact[] = [];
  const droppedReasons: string[] = [];
  const seen = new Set<string>();

  for (const candidate of value.facts) {
    const statement = candidate.statement.trim();
    const span = candidate.evidenceSpan.trim();

    if (!statement || !span) {
      droppedReasons.push(`empty statement or span: "${statement.slice(0, 60)}"`);
      continue;
    }

    // THE INVARIANT. Checked against the text we actually stored, not the
    // text the model thinks it read.
    const offset = locateSpan(source, span);
    if (offset === -1) {
      droppedReasons.push(
        `evidence span not found verbatim on the page: "${span.slice(0, 80)}"`,
      );
      continue;
    }

    // A span that matches most of the page is not evidence for anything.
    if (span.length > 600) {
      droppedReasons.push(`evidence span too long to be specific (${span.length} chars)`);
      continue;
    }

    const dedupeKey = statement.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    facts.push({
      statement,
      category: candidate.category as FactCategory,
      evidenceSpan: span,
      evidenceOffset: offset,
    });
  }

  return {
    facts,
    dropped: value.facts.length - facts.length,
    droppedReasons,
    records: [record],
  };
}
