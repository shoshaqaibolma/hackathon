import { callObject, type CallContext, type CallRecord } from "@/lib/llm/call";
import { writerModelFor } from "@/lib/llm/models";
import { displayName } from "@/lib/pipeline/questions";
import { RemediationPatch, RemediationPatchSchema } from "@/lib/schemas";
import type { LedgerFact } from "@/lib/pipeline/adjudicate";
import type { RemediationKind } from "@prisma/client";

/**
 * Remediation — the loop closer.
 *
 * Every other tool in this category stops at the finding. This turns each
 * finding into something you can paste: a block for `llms.txt`, a JSON-LD
 * snippet, or replacement page copy.
 *
 * The hard constraint is that a patch must only ever restate what the page
 * already says. We are correcting what models believe about a company, not
 * writing their marketing — inventing a fact here would make Parity the very
 * thing it audits. The patch is therefore generated from the cited ledger
 * fact and validated against it before it is kept.
 */

export type Remediation = {
  kind: RemediationKind;
  content: string;
  targetUrl: string | null;
  rationale: string;
};

export type RemediationResult = {
  remediation: Remediation | null;
  /** Set when a generated patch was rejected, with the reason. */
  rejected: string | null;
  records: CallRecord[];
};

const SYSTEM = `You write a correction that makes a company's own website state a fact unambiguously, so AI assistants stop getting it wrong.

You are given: the question a customer asked, what a model wrongly claimed, and the TRUE fact from the company's site with its exact source text.

Choose the format that fixes it best:
- LLMS_TXT:  a block for /llms.txt. Plain markdown, a heading and terse factual lines. Best for pricing, limits and eligibility.
- JSON_LD:   a schema.org JSON-LD snippet. Best for structured commercial facts — Product, Offer, FAQPage.
- PAGE_COPY: replacement prose for the page itself. Best when the page is ambiguous rather than silent.

ABSOLUTE RULE: state ONLY what the provided fact and its evidence text already
say. Never invent a number, a plan name, a date or a feature. Never soften or
embellish. If the fact is thin, write something thin. You are correcting a
record, not writing marketing copy.`;

/** Numbers and prices the patch is allowed to contain: those already on the page. */
function numericTokens(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/\d[\d,._]*\s*%?/g)?.map((t) => t.trim()) ?? []);
}

/**
 * Rejects a patch that introduces a number the source fact does not contain.
 *
 * This is the mechanical version of the absolute rule above. A model that
 * invents "$29/month" while correcting a pricing error would be doing exactly
 * what we flag it for, and a prompt alone is not sufficient assurance.
 */
export function validatePatch(
  content: string,
  fact: LedgerFact,
): { ok: true } | { ok: false; reason: string } {
  if (!content.trim()) return { ok: false, reason: "empty patch" };

  const allowed = new Set([
    ...numericTokens(fact.statement),
    ...numericTokens(fact.evidenceSpan),
    ...numericTokens(fact.sourceUrl),
  ]);

  for (const token of numericTokens(content)) {
    // Ignore trivial values that appear structurally rather than factually.
    if (/^[0-9]$/.test(token)) continue;
    if (!allowed.has(token)) {
      return {
        ok: false,
        reason: `patch introduces "${token}", which does not appear in the cited fact`,
      };
    }
  }

  return { ok: true };
}

export async function remediate(
  domain: string,
  question: string,
  wrongClaim: string,
  fact: LedgerFact,
  context: CallContext,
): Promise<RemediationResult> {
  const prompt = `Company: ${displayName(domain)} (${domain})

CUSTOMER ASKED
${question}

WHAT THE MODEL WRONGLY CLAIMED
"${wrongClaim}"

THE TRUE FACT, from ${fact.sourceUrl}
${fact.statement}

EXACT TEXT ON THE PAGE
"${fact.evidenceSpan}"

Write the correction.`;

  const { value, record } = await callObject(
    writerModelFor(context.credential ?? null),
    RemediationPatchSchema,
    RemediationPatch,
    SYSTEM,
    prompt,
    context,
  );

  const check = validatePatch(value.content, fact);
  if (!check.ok) {
    return { remediation: null, rejected: check.reason, records: [record] };
  }

  return {
    remediation: {
      kind: value.kind as RemediationKind,
      content: value.content.trim(),
      targetUrl: fact.sourceUrl || null,
      rationale: value.rationale,
    },
    rejected: null,
    records: [record],
  };
}
