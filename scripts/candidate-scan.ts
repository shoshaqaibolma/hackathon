/**
 * Reduced scan for fixture-candidate screening.
 *
 *   pnpm candidate:scan tavily.com stripe.com ...
 *   pnpm candidate:scan --file candidates.txt
 *
 * Ranks domains by how badly models get them wrong, so the DRIFT fixture is
 * chosen by data rather than intuition.
 *
 * This is a SCREENING tool, not the product pipeline. It crawls 3 pages,
 * extracts pricing-weighted facts, asks 4 questions from parametric memory
 * only, and collapses claim-decomposition and adjudication into one call.
 * The product keeps those stages separate so each is inspectable; here the
 * only output that matters is a comparable number per domain.
 *
 * Writes candidates/<domain>.json plus a ranked summary table.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CAPS } from "@/lib/config";
import { discover } from "@/lib/crawl/discover";
import { extract } from "@/lib/crawl/extract";
import { fetchPage } from "@/lib/crawl/fetch";
import { prioritise } from "@/lib/crawl/prioritise";
import { callObject, callText, ModelCallError, type CallRecord } from "@/lib/llm/call";
import { GEMINI_FLASH, QWEN_27B } from "@/lib/llm/models";
import { checkScanIntegrity } from "@/lib/pipeline/integrity";
import { filterClaims, isRefusal } from "@/lib/pipeline/claims";
import { extractFacts, type ExtractedFact } from "@/lib/pipeline/facts";
import {
  QuestionBatch,
  QuestionBatchSchema,
  Screening,
  ScreeningSchema,
} from "@/lib/schemas";
import { composition, parityScore } from "@/lib/score";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    /* absent is fine */
  }
}

const PAGES_PER_DOMAIN = 3;
const QUESTIONS_PER_DOMAIN = 4;
const FACTS_PER_PAGE = 8;

type DomainReport = {
  domain: string;
  scannedAt: string;
  pages: { url: string; chars: number; status: string }[];
  facts: ExtractedFact[];
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
  wrongShare: number;
  integrityViolations: number;
  warnings: string[];
  elapsedMs: number;
  calls: number;
  throttledMs: number;
};

async function screenDomain(domain: string): Promise<DomainReport> {
  const started = Date.now();
  const records: CallRecord[] = [];
  const warnings: string[] = [];
  const context = {
    stage: "SCREEN",
    onThrottle: (n: { provider: string; reason: string; waitMs: number }) =>
      console.log(`      throttled ${n.waitMs}ms (${n.reason})`),
  };

  // --- crawl ------------------------------------------------------------
  const discovery = await discover(domain);
  warnings.push(...discovery.warnings);

  if (discovery.blockedByRobots) {
    return emptyReport(domain, started, ["robots.txt disallows crawling"], records);
  }

  const top = prioritise(discovery.candidates, domain, PAGES_PER_DOMAIN);
  const pages: DomainReport["pages"] = [];
  const facts: (ExtractedFact & { sourceUrl: string })[] = [];

  for (const candidate of top) {
    const fetched = await fetchPage(candidate.url);
    if (fetched.status !== "OK" || !fetched.html) {
      pages.push({ url: candidate.url, chars: 0, status: fetched.status });
      continue;
    }

    const extracted = extract(fetched.html, candidate.url);
    pages.push({ url: candidate.url, chars: extracted.text.length, status: "OK" });
    if (extracted.text.length < 300) continue;

    const result = await extractFacts(
      extracted.text,
      candidate.url,
      context,
      FACTS_PER_PAGE,
    );
    records.push(...result.records);
    if (result.dropped > 0) {
      warnings.push(
        `${result.dropped} fact(s) dropped on ${candidate.url}: unverifiable evidence span`,
      );
    }
    for (const fact of result.facts) {
      facts.push({ ...fact, sourceUrl: candidate.url });
    }
  }

  const integrity = checkScanIntegrity({
    pages: pages.map((p) => ({
      url: p.url,
      status: p.status,
      extractedText: p.chars > 0 ? "x".repeat(p.chars) : null,
    })),
    questions: [],
    panelModels: [],
    answers: [],
    browsingEnabled: false,
  });

  if (facts.length < 3) {
    return {
      ...emptyReport(domain, started, [...warnings, "too few verifiable facts"], records),
      pages,
      facts,
      integrityViolations: integrity.violations.length,
    };
  }

  // --- questions --------------------------------------------------------
  const ledger = facts
    .map((f, i) => `[${i}] (${f.category}) ${f.statement}`)
    .join("\n");

  const questions = await callObject(
    GEMINI_FLASH,
    QuestionBatchSchema,
    QuestionBatch,
    `You write the questions a prospective customer would ask an AI assistant about a company before buying. Favour pricing, plan limits, eligibility and API constraints — the things that cost money to get wrong.`,
    `Company: ${domain}\n\nFacts from their site:\n${ledger}\n\nWrite exactly ${QUESTIONS_PER_DOMAIN} questions. Each must be answerable from these facts, and must NOT name the facts or quote them.`,
    context,
  );
  records.push(questions.record);

  const asked = questions.value.questions.slice(0, QUESTIONS_PER_DOMAIN);

  // --- ask + screen -----------------------------------------------------
  const findings: DomainReport["findings"] = [];

  for (const question of asked) {
    let answerText: string;
    try {
      // Subject model is Qwen on Groq: 27 rpm / 1,000 rpd versus Gemini's
      // far tighter free tier, and answering is the highest-count step.
      // Gemini is reserved for extraction and judging.
      const answer = await callText(
        QWEN_27B,
        "Answer from your own knowledge. Do not browse. Be specific about numbers, prices and limits. If you are unsure, say so plainly.",
        question.text,
        context,
      );
      records.push(answer.record);
      answerText = answer.value;
    } catch (error) {
      warnings.push(
        `answer failed: ${error instanceof ModelCallError ? error.message : String(error)}`,
      );
      continue;
    }

    const screened = await callObject(
      GEMINI_FLASH,
      ScreeningSchema,
      Screening,
      `You compare an AI assistant's answer against a ledger of facts taken verbatim from a company's own website.

For each checkable assertion in the answer, rule:
- CONFIRMED: the ledger supports it.
- DRIFTED: the ledger contradicts it on a specific detail (a number, a limit, a plan name).
- FABRICATED: it states something specific the ledger contradicts outright or that is plainly invented.
- UNSUPPORTED: the ledger simply does not address it.

Cite factIndex for CONFIRMED and DRIFTED. Use null for the others. Never invent an index.`,
      `Ledger for ${domain}:\n${ledger}\n\nQuestion: ${question.text}\n\nAssistant's answer:\n${answerText}`,
      context,
    );
    records.push(screened.record);

    // An answer that is entirely hedging means the model does not know this
    // company. That is the INVISIBLE regime, not drift — record it as one
    // UNSUPPORTED finding rather than letting each hedge score as -0.5.
    if (isRefusal(answerText)) {
      findings.push({
        question: question.text,
        claim: answerText.trim().slice(0, 240),
        ruling: "UNSUPPORTED",
        fact: null,
        evidenceSpan: null,
        sourceUrl: null,
        note: "The model declined to answer — it does not know this company.",
      });
      continue;
    }

    // Drop hedges and any claim the extractor rewrote rather than quoted.
    const hygiene = filterClaims(
      answerText,
      screened.value.findings.map((f) => f.claim),
    );
    const allowed = new Set(hygiene.claims.map((c) => c.text));
    if (hygiene.dropped > 0) {
      warnings.push(
        `${hygiene.dropped} claim(s) dropped: ${hygiene.droppedReasons[0] ?? ""}`,
      );
    }

    for (const finding of screened.value.findings) {
      if (!allowed.has(finding.claim.trim())) continue;
      const fact =
        finding.factIndex !== null && finding.factIndex >= 0
          ? facts[finding.factIndex]
          : undefined;

      // Same validation the product pipeline applies: a citation the model
      // was not given is not a citation.
      const cited =
        fact && (finding.ruling === "CONFIRMED" || finding.ruling === "DRIFTED")
          ? fact
          : undefined;
      const ruling =
        (finding.ruling === "CONFIRMED" || finding.ruling === "DRIFTED") && !cited
          ? "UNSUPPORTED"
          : finding.ruling;

      findings.push({
        question: question.text,
        claim: finding.claim,
        ruling,
        fact: cited?.statement ?? null,
        evidenceSpan: cited?.evidenceSpan ?? null,
        sourceUrl: cited?.sourceUrl ?? null,
        note: finding.note,
      });
    }
  }

  const scorables = findings.map((f) => ({
    ruling: f.ruling as "CONFIRMED" | "DRIFTED" | "FABRICATED" | "UNSUPPORTED",
    citedFactCategory: null,
    questionCategory: null,
  }));

  const wrong = findings.filter(
    (f) => f.ruling === "DRIFTED" || f.ruling === "FABRICATED",
  ).length;

  return {
    domain,
    scannedAt: new Date().toISOString(),
    pages,
    facts,
    questions: asked.map((q) => q.text),
    findings,
    score: parityScore(scorables),
    wrongShare: findings.length > 0 ? wrong / findings.length : 0,
    integrityViolations: integrity.violations.length,
    warnings,
    elapsedMs: Date.now() - started,
    calls: records.length,
    throttledMs: records.reduce((n, r) => n + r.throttledMs, 0),
  };
}

function emptyReport(
  domain: string,
  started: number,
  warnings: string[],
  records: CallRecord[],
): DomainReport {
  return {
    domain,
    scannedAt: new Date().toISOString(),
    pages: [],
    facts: [],
    questions: [],
    findings: [],
    score: null,
    wrongShare: 0,
    integrityViolations: 0,
    warnings,
    elapsedMs: Date.now() - started,
    calls: records.length,
    throttledMs: 0,
  };
}

async function main() {
  const args = process.argv.slice(2);
  let domains: string[] = [];

  const fileFlag = args.indexOf("--file");
  if (fileFlag !== -1) {
    const path = args[fileFlag + 1];
    domains = readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  } else {
    domains = args.filter((a) => !a.startsWith("--"));
  }

  if (domains.length === 0) {
    console.error(
      "Usage: pnpm candidate:scan <domain...>\n" +
        "       pnpm candidate:scan --file candidates.txt",
    );
    process.exit(1);
  }

  const outDir = join(process.cwd(), "candidates");
  mkdirSync(outDir, { recursive: true });

  const reports: DomainReport[] = [];

  for (const [i, domain] of domains.entries()) {
    console.log(`\n[${i + 1}/${domains.length}] ${domain}`);
    try {
      const report = await screenDomain(domain);
      reports.push(report);
      writeFileSync(
        join(outDir, `${domain.replace(/[^a-z0-9.-]/gi, "_")}.json`),
        `${JSON.stringify(report, null, 2)}\n`,
        "utf8",
      );
      console.log(
        `      pages=${report.pages.length} facts=${report.facts.length} ` +
          `findings=${report.findings.length} score=${report.score?.toFixed(1) ?? "—"} ` +
          `wrong=${(report.wrongShare * 100).toFixed(0)}% ` +
          `${(report.elapsedMs / 1000).toFixed(1)}s calls=${report.calls}`,
      );
      for (const warning of report.warnings.slice(0, 3)) {
        console.log(`      warn: ${warning}`);
      }
    } catch (error) {
      console.log(`      FAILED: ${error instanceof Error ? error.message : error}`);
    }
  }

  // --- ranked summary ---------------------------------------------------
  console.log(`\n${"=".repeat(78)}`);
  console.log("RANKED BY DRIFT — lowest score first. Regime targets:");
  console.log("  CONTROL ~75+   INVISIBLE ~50   DRIFT well below 50");
  console.log("=".repeat(78));
  console.log(
    `${"domain".padEnd(26)}${"score".padStart(7)}${"wrong%".padStart(8)}` +
      `${"facts".padStart(7)}${"finds".padStart(7)}${"secs".padStart(7)}`,
  );

  const ranked = [...reports].sort(
    (a, b) => (a.score ?? 999) - (b.score ?? 999),
  );

  for (const r of ranked) {
    const regime =
      r.score === null
        ? "unscored"
        : r.score >= 70
          ? "CONTROL"
          : r.score >= 40
            ? "INVISIBLE"
            : "DRIFT";
    console.log(
      `${r.domain.padEnd(26)}${(r.score?.toFixed(1) ?? "—").padStart(7)}` +
        `${(r.wrongShare * 100).toFixed(0).padStart(8)}${String(r.facts.length).padStart(7)}` +
        `${String(r.findings.length).padStart(7)}${(r.elapsedMs / 1000).toFixed(0).padStart(7)}` +
        `   ${regime}`,
    );
  }

  const totalMs = reports.reduce((n, r) => n + r.elapsedMs, 0);
  const totalCalls = reports.reduce((n, r) => n + r.calls, 0);
  const totalThrottle = reports.reduce((n, r) => n + r.throttledMs, 0);
  console.log(
    `\n${reports.length} domains · ${totalCalls} model calls · ` +
      `${(totalMs / 1000).toFixed(0)}s total · ${(totalThrottle / 1000).toFixed(0)}s throttled`,
  );
  console.log(`Reports written to ${outDir}`);
  console.log(
    `\nConcurrency is deliberately 1 (cap: ${CAPS.CONCURRENCY} in the product) so ` +
      `these timings are a clean per-domain baseline.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => process.exit(0));
