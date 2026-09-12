import { callObject, type CallContext, type CallRecord } from "@/lib/llm/call";
import { adjudicatorFor } from "@/lib/llm/models";
import { VerdictBatch, VerdictBatchSchema } from "@/lib/schemas";
import type { FactCategory, Ruling } from "@prisma/client";

/**
 * Evidence-forced adjudication.
 *
 * The adjudicator may only rule against facts it was actually shown, and a
 * CONFIRMED or DRIFTED verdict must name the fact it relied on. Because the
 * judge is a fast model, the validation below is not a safety net — it is the
 * primary guard on verdict quality, and it runs on every call.
 */

export type LedgerFact = {
  id: string;
  statement: string;
  category: FactCategory;
  evidenceSpan: string;
  sourceUrl: string;
};

export type AdjudicatedClaim = {
  claimText: string;
  ruling: Ruling;
  confidence: number;
  citedFactId: string | null;
  evidenceQuote: string | null;
  reasoning: string;
  /** True when validation overrode the model's ruling. */
  downgraded: boolean;
};

export type AdjudicationResult = {
  verdicts: AdjudicatedClaim[];
  downgraded: number;
  records: CallRecord[];
};

const SYSTEM = `You compare an AI assistant's claims against a ledger of facts taken verbatim from a company's own website.

Rule each claim:
- CONFIRMED:   a ledger fact supports it.
- DRIFTED:     a ledger fact contradicts it on a specific detail — a number, a limit, a plan name, an eligibility rule.
- FABRICATED:  it asserts something specific that the ledger contradicts outright, or that is plainly invented.
- UNSUPPORTED: the ledger does not address it either way.

Rules you must follow:
- CONFIRMED and DRIFTED REQUIRE citedFactId, and it must be one of the ids listed. Never invent an id.
- FABRICATED and UNSUPPORTED must use citedFactId: null.
- evidenceQuote must be copied exactly from the cited fact's evidence span.
- Judge ONLY against the ledger. You have no other knowledge of this company.
- If the ledger is silent, the answer is UNSUPPORTED. Do not guess.`;

function renderLedger(facts: readonly LedgerFact[]): string {
  return facts
    .map(
      (fact) =>
        `id: ${fact.id}\n  (${fact.category}) ${fact.statement}\n  evidence: "${fact.evidenceSpan}"`,
    )
    .join("\n\n");
}

export async function adjudicate(
  question: string,
  claims: readonly string[],
  ledger: readonly LedgerFact[],
  context: CallContext,
): Promise<AdjudicationResult> {
  if (claims.length === 0) {
    return { verdicts: [], downgraded: 0, records: [] };
  }

  const prompt = `LEDGER
${renderLedger(ledger)}

QUESTION ASKED
${question}

CLAIMS TO RULE ON
${claims.map((claim, i) => `[${i}] ${claim}`).join("\n")}

Return one verdict per claim, using claimIndex to identify it.`;

  const { value, record } = await callObject(
    adjudicatorFor(context.credential ?? null),
    VerdictBatchSchema,
    VerdictBatch,
    SYSTEM,
    prompt,
    context,
  );

  const byId = new Map(ledger.map((fact) => [fact.id, fact]));
  const verdicts: AdjudicatedClaim[] = [];
  let downgraded = 0;

  for (const raw of value.verdicts) {
    const claimText = claims[raw.claimIndex];
    if (claimText === undefined) continue;

    const cited = raw.citedFactId ? byId.get(raw.citedFactId) : undefined;
    const needsCitation = raw.ruling === "CONFIRMED" || raw.ruling === "DRIFTED";

    // THE GUARD. A citation the adjudicator was not shown is not a citation,
    // and a ruling that depends on one cannot stand.
    let ruling = raw.ruling as Ruling;
    let wasDowngraded = false;
    if (needsCitation && !cited) {
      ruling = "UNSUPPORTED";
      wasDowngraded = true;
      downgraded += 1;
    }

    // An uncited ruling must not carry a citation either.
    const citedFactId = ruling === "CONFIRMED" || ruling === "DRIFTED"
      ? (cited?.id ?? null)
      : null;

    verdicts.push({
      claimText,
      ruling,
      confidence: Math.min(1, Math.max(0, raw.confidence)),
      citedFactId,
      // Prefer the fact's real span over whatever the model echoed, so the
      // drift card always quotes the page rather than a paraphrase of it.
      evidenceQuote: citedFactId ? (cited?.evidenceSpan ?? null) : null,
      reasoning: wasDowngraded
        ? `${raw.reasoning} (Downgraded: cited a fact that was not in the ledger.)`
        : raw.reasoning,
      downgraded: wasDowngraded,
    });
  }

  return { verdicts, downgraded, records: [record] };
}

/**
 * Selects the ledger slice shown to the adjudicator for one answer.
 *
 * Sending the whole ledger invites the judge to find some unrelated fact that
 * loosely supports a claim. Sending too little makes everything UNSUPPORTED.
 * Lexical overlap with the question and the claims, capped.
 */
export function selectLedgerSlice(
  facts: readonly LedgerFact[],
  question: string,
  claims: readonly string[],
  limit: number,
): LedgerFact[] {
  const haystack = `${question} ${claims.join(" ")}`.toLowerCase();
  const terms = new Set(
    haystack
      .replace(/[^a-z0-9%$.\s-]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3),
  );

  const scored = facts.map((fact) => {
    const text = `${fact.statement} ${fact.evidenceSpan}`.toLowerCase();
    let score = 0;
    for (const term of terms) if (text.includes(term)) score += 1;
    return { fact, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.fact);
}
