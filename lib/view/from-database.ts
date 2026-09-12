import type { Ruling } from "@prisma/client";

import { RULING_SCORE } from "@/lib/config";
import { prisma } from "@/lib/db";
import {
  IntegrityViolationSchema,
  summariseIntegrity,
  type IntegrityViolation,
} from "@/lib/pipeline/integrity";
import { composition, interpret, parityScore, weightFor } from "@/lib/score";
import { RetrievedSnippetSchema } from "@/lib/search/types";
import type {
  CostLine,
  DriftCard,
  RunView,
  ScanView,
} from "@/lib/view/types";

/**
 * Assembles a ScanView from the database.
 *
 * The counterpart of the fixture loader: both produce the same type, so the
 * DEMO path and the live product render through identical components and
 * cannot drift apart.
 */

/** Most severe first: fabrications before drift, heavier categories first. */
function severity(card: DriftCard): number {
  const magnitude = Math.abs(RULING_SCORE[card.ruling as Ruling]);
  return card.weight * magnitude;
}

function parseRetrieval(value: unknown) {
  if (!Array.isArray(value)) return [];
  const parsed = RetrievedSnippetSchema.array().safeParse(value);
  return parsed.success ? parsed.data : [];
}

export async function buildScanView(scanId: string): Promise<ScanView | null> {
  const scan = await prisma.scan.findUnique({
    where: { id: scanId },
    include: {
      pages: { orderBy: { priority: "desc" } },
      facts: { include: { page: { select: { title: true, fetchedAt: true } } } },
      questions: true,
      remediations: true,
      llmCalls: true,
      runs: {
        orderBy: { index: "asc" },
        include: {
          answers: {
            include: {
              question: true,
              claims: { include: { verdict: { include: { citedFact: true } } } },
            },
          },
        },
      },
    },
  });

  if (!scan) return null;

  const factCountByPage = new Map<string, number>();
  for (const fact of scan.facts) {
    factCountByPage.set(fact.pageId, (factCountByPage.get(fact.pageId) ?? 0) + 1);
  }

  const remediationByVerdict = new Map(
    scan.remediations.map((r) => [r.verdictId, r]),
  );

  // When each fact's source page was fetched — the "as captured on" date.
  const factCapturedAt = new Map<string, string>();
  for (const fact of scan.facts) {
    const captured = fact.page.fetchedAt ?? fact.createdAt;
    factCapturedAt.set(fact.id, captured.toISOString());
  }

  const runs: RunView[] = scan.runs.map((run) => {
    const cards: DriftCard[] = [];
    let failedAnswerCount = 0;

    for (const answer of run.answers) {
      if (answer.error) failedAnswerCount += 1;

      for (const claim of answer.claims) {
        const verdict = claim.verdict;
        if (!verdict) continue;

        const scorable = {
          ruling: verdict.ruling,
          citedFactCategory: verdict.citedFact?.category ?? null,
          questionCategory: answer.question.category,
        };

        const remediation = remediationByVerdict.get(verdict.id);

        cards.push({
          id: verdict.id,
          question: answer.question.text,
          questionCategory: answer.question.category,
          model: answer.model,
          modelLabel: answer.model,
          // Provider is derived at render time from the panel registry; the
          // recorded model id is the durable fact.
          provider: providerForModel(answer.model),
          condition: answer.condition,
          latencyMs: answer.latencyMs,
          claimText: claim.text,
          answerExcerpt: answer.rawText?.slice(0, 400) ?? null,
          ruling: verdict.ruling,
          confidence: verdict.confidence,
          reasoning: verdict.reasoning,
          downgraded: verdict.downgraded,
          groundTruth: verdict.citedFact
            ? {
                id: verdict.citedFact.id,
                statement: verdict.citedFact.statement,
                category: verdict.citedFact.category,
                evidenceSpan: verdict.citedFact.evidenceSpan,
                sourceUrl: verdict.citedFact.sourceUrl,
                pageTitle: null,
              }
            : null,
          evidenceQuote: verdict.evidenceQuote,
          searchQuery: answer.searchQuery,
          retrieval: parseRetrieval(answer.retrieval),
          remediation: remediation
            ? {
                id: remediation.id,
                kind: remediation.kind,
                content: remediation.content,
                targetUrl: remediation.targetUrl,
                rationale: remediation.rationale,
              }
            : null,
          weight: weightFor(scorable),
          // Publication rule: every finding carries when it was produced and
          // when the source it cites was captured.
          askedAt: answer.createdAt.toISOString(),
          sourceCapturedAt: verdict.citedFact
            ? (factCapturedAt.get(verdict.citedFact.id) ?? scan.createdAt.toISOString())
            : null,
        });
      }
    }

    cards.sort((a, b) => severity(b) - severity(a));

    const scorables = cards.map((card) => ({
      ruling: card.ruling,
      citedFactCategory: card.groundTruth?.category ?? null,
      questionCategory: card.questionCategory,
    }));

    return {
      id: run.id,
      index: run.index,
      label: run.label,
      parityScore: run.parityScore ?? parityScore(scorables),
      composition: composition(scorables),
      driftCards: cards,
      answerCount: run.answers.length,
      failedAnswerCount,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
    };
  });

  const latest = runs.at(-1);

  const integrity = parseIntegrity(scan.integrity);
  const intact = integrity.length === 0;

  // A score built from structurally incomplete data must never reach a
  // renderer. Forcing null here means no component can accidentally show
  // one — the guarantee lives in the builder, not in each consumer.
  const score = intact ? (scan.parityScore ?? latest?.parityScore ?? null) : null;

  return {
    id: scan.id,
    domain: scan.domain,
    mode: scan.mode,
    status: scan.status,
    parityScore: score,
    interpretation: intact ? interpret(score) : summariseIntegrity(integrity),
    integrity,
    composition: latest?.composition ?? composition([]),
    warnings: scan.warnings,
    error: scan.error,
    createdAt: scan.createdAt.toISOString(),
    finishedAt: scan.finishedAt?.toISOString() ?? null,
    panel: [],
    pages: scan.pages.map((page) => ({
      id: page.id,
      url: page.url,
      title: page.title,
      status: page.status,
      httpStatus: page.httpStatus,
      error: page.error,
      factCount: factCountByPage.get(page.id) ?? 0,
      factsDropped: page.factsDropped,
    })),
    facts: scan.facts.map((fact) => ({
      id: fact.id,
      statement: fact.statement,
      category: fact.category,
      evidenceSpan: fact.evidenceSpan,
      sourceUrl: fact.sourceUrl,
      pageTitle: fact.page.title,
    })),
    questions: scan.questions.map((question) => ({
      id: question.id,
      text: question.text,
      category: question.category,
      targetFactIds: question.targetFactIds,
    })),
    runs,
    remediations: scan.remediations.map((r) => ({
      id: r.id,
      kind: r.kind,
      content: r.content,
      targetUrl: r.targetUrl,
      rationale: r.rationale,
    })),
    cost: buildCost(scan.llmCalls),
  };
}

function parseIntegrity(value: unknown): IntegrityViolation[] {
  if (!Array.isArray(value)) return [];
  const parsed = IntegrityViolationSchema.array().safeParse(value);
  return parsed.success ? parsed.data : [];
}

function providerForModel(model: string): DriftCard["provider"] {
  if (model.startsWith("gemini")) return "GOOGLE";
  if (model.startsWith("claude")) return "ANTHROPIC";
  if (model.startsWith("gpt") || model.startsWith("o")) return "OPENAI";
  return "GROQ";
}

type LlmCallRow = {
  stage: string;
  provider: DriftCard["provider"];
  model: string;
  cached: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
};

/**
 * Groups calls into a cost table. `cachedCalls` is the honesty column — a
 * BYOK user must see which work came from a previous scan's cache rather
 * than believing they paid for it again.
 */
export function buildCost(calls: readonly LlmCallRow[]) {
  const byKey = new Map<string, CostLine>();

  for (const call of calls) {
    const key = `${call.stage}|${call.model}`;
    const line = byKey.get(key) ?? {
      stage: call.stage,
      provider: call.provider,
      model: call.model,
      calls: 0,
      cachedCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
    };

    line.calls += 1;
    if (call.cached) line.cachedCalls += 1;
    line.inputTokens = (line.inputTokens ?? 0) + (call.inputTokens ?? 0);
    line.outputTokens = (line.outputTokens ?? 0) + (call.outputTokens ?? 0);
    if (call.costUsd !== null) {
      line.costUsd = (line.costUsd ?? 0) + call.costUsd;
    }

    byKey.set(key, line);
  }

  const lines = [...byKey.values()];
  const priced = lines.filter((l) => l.costUsd !== null);

  return {
    lines,
    totalCalls: calls.length,
    cachedCalls: calls.filter((c) => c.cached).length,
    totalCostUsd:
      priced.length > 0 ? priced.reduce((sum, l) => sum + (l.costUsd ?? 0), 0) : null,
  };
}
