import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { QWEN_27B } from "@/lib/llm/models";
import {
  composition,
  interpret,
  interpretWrongShare,
  parityScore,
  wrongShare,
} from "@/lib/score";
import type { DriftCard, ScanView } from "@/lib/view/types";

/**
 * Screening reports, rendered as real audits.
 *
 * These are the eleven scans behind the published study. They are memory-only
 * and shallower than a full scan, and the UI says so — but they are genuine
 * audits of real sites with real evidence, so a visitor who types a domain we
 * have already measured gets a result instead of a signup form.
 *
 * Committed to the repository, like fixtures, so these pages work with no
 * database and no network.
 */

const DIR = join(process.cwd(), "candidates");

type RawReport = {
  domain: string;
  scannedAt: string;
  pages: { url: string; chars: number; status: string }[];
  facts: {
    statement: string;
    category: string;
    evidenceSpan: string;
    sourceUrl: string;
  }[];
  questions: string[];
  findings: {
    question: string;
    claim: string;
    ruling: string;
    fact: string | null;
    evidenceSpan: string | null;
    sourceUrl: string | null;
    note: string;
  }[];
  score: number | null;
  unreliable: boolean;
  wrongShare: number;
  warnings: string[];
};

let cache: Map<string, RawReport> | null = null;

function loadAll(): Map<string, RawReport> {
  if (cache && process.env.NODE_ENV !== "development") return cache;

  const map = new Map<string, RawReport>();
  let files: string[] = [];
  try {
    files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
  } catch {
    cache = map;
    return map;
  }

  for (const file of files) {
    try {
      const report = JSON.parse(readFileSync(join(DIR, file), "utf8")) as RawReport;
      // Never surface a scan the screener itself marked untrustworthy.
      if (report.unreliable || report.score === null) continue;
      map.set(report.domain.toLowerCase(), report);
    } catch {
      // A malformed report is skipped, never rendered half-formed.
    }
  }

  cache = map;
  return map;
}

export function hasReport(domain: string): boolean {
  return loadAll().has(domain.toLowerCase());
}

export function listReportDomains(): string[] {
  return [...loadAll().keys()].sort();
}

export function getReportView(domain: string): ScanView | null {
  const report = loadAll().get(domain.toLowerCase());
  if (!report) return null;

  const asked = report.scannedAt;

  const cards: DriftCard[] = report.findings.map((finding, index) => {
    const hasSpan = Boolean(finding.fact && finding.evidenceSpan?.trim());
    const fact = hasSpan
      ? {
          id: `f${index}`,
          statement: finding.fact as string,
          category: "GENERAL" as const,
          evidenceSpan: finding.evidenceSpan as string,
          sourceUrl: finding.sourceUrl ?? "",
          pageTitle: null,
        }
      : null;

    return {
      id: `${report.domain}-${index}`,
      question: finding.question,
      questionCategory: "GENERAL" as const,
      model: QWEN_27B.modelId,
      modelLabel: QWEN_27B.label,
      provider: "GROQ" as const,
      condition: "MEMORY" as const,
      latencyMs: null,
      claimText: finding.claim,
      answerExcerpt: null,
      ruling: finding.ruling as DriftCard["ruling"],
      confidence: 0,
      reasoning: finding.note,
      downgraded: false,
      groundTruth: fact,
      evidenceQuote: finding.evidenceSpan,
      searchQuery: null,
      retrieval: [],
      remediation: null,
      weight: 1,
      // Publication rule: a finding carries when it was made, and a cited
      // source carries when that page was captured.
      askedAt: asked,
      sourceCapturedAt: fact ? asked : null,
    };
  });

  const scorables = cards.map((card) => ({
    ruling: card.ruling,
    citedFactCategory: null,
    questionCategory: null,
  }));

  const wrong = wrongShare(scorables);
  const score = parityScore(scorables);
  const comp = composition(scorables);

  return {
    id: `report-${report.domain}`,
    domain: report.domain,
    mode: "FREE",
    status: "COMPLETE",
    parityScore: score,
    interpretation: interpret(score),
    claimsWrong: wrong.wrong,
    claimsCheckable: wrong.checkable,
    wrongHeadline: interpretWrongShare(wrong),
    composition: comp,
    warnings: report.warnings ?? [],
    error: null,
    integrity: [],
    createdAt: report.scannedAt,
    finishedAt: report.scannedAt,
    panel: [
      { id: QWEN_27B.modelId, label: QWEN_27B.label, provider: "GROQ" as const },
    ],
    pages: report.pages.map((page, i) => ({
      id: `p${i}`,
      url: page.url,
      title: null,
      status: page.status as ScanView["pages"][number]["status"],
      httpStatus: null,
      error: null,
      factCount: report.facts.filter((f) => f.sourceUrl === page.url).length,
      factsDropped: 0,
    })),
    facts: report.facts.map((fact, i) => ({
      id: `f${i}`,
      statement: fact.statement,
      category: fact.category as ScanView["facts"][number]["category"],
      evidenceSpan: fact.evidenceSpan,
      sourceUrl: fact.sourceUrl,
      pageTitle: null,
    })),
    questions: report.questions.map((text, i) => ({
      id: `q${i}`,
      text,
      category: "GENERAL" as const,
      targetFactIds: [],
    })),
    runs: [
      {
        id: "run-0",
        index: 0,
        label: "Screening",
        parityScore: score,
        composition: comp,
        driftCards: cards,
        answerCount: report.questions.length,
        failedAnswerCount: 0,
        startedAt: report.scannedAt,
        finishedAt: report.scannedAt,
      },
    ],
    remediations: [],
    cost: { lines: [], totalCalls: 0, cachedCalls: 0, totalCostUsd: null },
  };
}
