/**
 * Records a full two-condition scan straight to a /demo fixture.
 *
 *   pnpm record heroku.com heroku "headline for the demo card"
 *
 * Runs the real pipeline — crawl, ledger, questions, both conditions across
 * the whole panel, claim hygiene, evidence-forced adjudication, remediation —
 * and writes fixtures/<slug>.json.
 *
 * Deliberately database-free. The orchestrator that persists a live scan does
 * not exist yet, and the fixture is what the demo actually serves, so this is
 * the shortest path from real data to the thing judges see.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CAPS, MODE_CAPS } from "@/lib/config";
import { discover } from "@/lib/crawl/discover";
import { extract } from "@/lib/crawl/extract";
import { fetchPage } from "@/lib/crawl/fetch";
import { prioritise } from "@/lib/crawl/prioritise";
import { callObject, type CallRecord } from "@/lib/llm/call";
import { FREE_PANEL, GEMINI_FLASH } from "@/lib/llm/models";
import { answerFromMemory, answerWithBrowsing } from "@/lib/pipeline/answer";
import {
  adjudicate,
  selectLedgerSlice,
  type LedgerFact,
} from "@/lib/pipeline/adjudicate";
import type { IntegrityAnswer } from "@/lib/pipeline/integrity";
import { filterClaims, isRefusal } from "@/lib/pipeline/claims";
import { dedupeFacts, extractFacts } from "@/lib/pipeline/facts";
import { checkScanIntegrity } from "@/lib/pipeline/integrity";
import { displayName, filterQuestions } from "@/lib/pipeline/questions";
import { remediate } from "@/lib/pipeline/remediate";
import {
  ClaimBatch,
  ClaimBatchSchema,
  QuestionBatch,
  QuestionBatchSchema,
} from "@/lib/schemas";
import {
  composition,
  interpret,
  interpretWrongShare,
  parityScore,
  weightFor,
  wrongShare,
} from "@/lib/score";
import { FIXTURE_VERSION, FixtureSchema, type DriftCard } from "@/lib/view/types";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    /* absent is fine */
  }
}

const CAPS_USED = MODE_CAPS.DEMO;
const QUESTIONS = Number(process.env.RECORD_QUESTIONS ?? 8);
const PAGES = Number(process.env.RECORD_PAGES ?? 6);

function log(msg: string) {
  console.log(`${new Date().toISOString().slice(11, 19)}  ${msg}`);
}

async function main() {
  const [domain, slug, headline] = process.argv.slice(2);
  if (!domain || !slug) {
    console.error('Usage: pnpm record <domain> <slug> "<headline>"');
    process.exit(1);
  }

  const started = Date.now();
  const records: CallRecord[] = [];
  const warnings: string[] = [];
  const context = {
    stage: "RECORD",
    onThrottle: (n: { reason: string; waitMs: number }) =>
      log(`   throttled ${(n.waitMs / 1000).toFixed(0)}s (${n.reason})`),
  };

  // --- crawl ------------------------------------------------------------
  log(`crawling ${domain}`);
  const discovery = await discover(domain);
  warnings.push(...discovery.warnings);
  if (discovery.blockedByRobots) {
    console.error("robots.txt disallows crawling this site.");
    process.exit(1);
  }

  const top = prioritise(discovery.candidates, domain, Math.min(PAGES, CAPS.MAX_PAGES));
  const pages: { url: string; chars: number; status: string; title: string | null }[] = [];
  const facts: (LedgerFact & { sourceUrl: string })[] = [];

  for (const candidate of top) {
    const fetched = await fetchPage(candidate.url);
    if (fetched.status !== "OK" || !fetched.html) {
      pages.push({ url: candidate.url, chars: 0, status: fetched.status, title: null });
      log(`   ${fetched.status} ${candidate.url}`);
      continue;
    }

    const extracted = extract(fetched.html, candidate.url);
    pages.push({
      url: candidate.url,
      chars: extracted.text.length,
      status: "OK",
      title: extracted.title,
    });
    if (extracted.text.length < 300) continue;

    const result = await extractFacts(extracted.text, candidate.url, context, 10);
    records.push(...result.records);
    if (result.dropped > 0) {
      warnings.push(`${result.dropped} fact(s) dropped on ${candidate.url}`);
    }
    for (const fact of result.facts) {
      facts.push({
        id: `f${facts.length}`,
        statement: fact.statement,
        category: fact.category,
        evidenceSpan: fact.evidenceSpan,
        sourceUrl: candidate.url,
      });
    }
    log(`   ${extracted.text.length} chars, ${result.facts.length} facts  ${candidate.url}`);
  }

  const deduped = dedupeFacts(facts);
  if (deduped.removed > 0) warnings.push(`${deduped.removed} duplicate fact(s) removed`);
  const ledger = deduped.facts.map((f, i) => ({ ...f, id: `f${i}` }));
  log(`ledger: ${ledger.length} facts from ${pages.filter((p) => p.status === "OK").length} pages`);

  if (ledger.length < 4) {
    console.error("Too few verifiable facts to record a meaningful fixture.");
    process.exit(1);
  }

  // --- questions --------------------------------------------------------
  const ledgerText = ledger.map((f, i) => `[${i}] (${f.category}) ${f.statement}`).join("\n");
  const q = await callObject(
    GEMINI_FLASH,
    QuestionBatchSchema,
    QuestionBatch,
    "You write the questions a prospective customer would ask an AI assistant about a company before buying. Favour pricing, plan limits, eligibility and API constraints — what costs money to get wrong.",
    `Company: ${displayName(domain)} (${domain})\n\nFacts from their site:\n${ledgerText}\n\nWrite exactly ${QUESTIONS} questions.\n\nREQUIREMENTS:\n- Every question MUST name "${displayName(domain)}" explicitly.\n- Do not quote or restate the facts.\n- Each must be answerable from the facts above.`,
    context,
  );
  records.push(q.record);

  const vetted = filterQuestions(q.value.questions.map((x) => x.text), domain);
  if (vetted.repaired > 0) warnings.push(`${vetted.repaired} question(s) rewritten to name the company`);
  const questions = vetted.questions.slice(0, Math.min(QUESTIONS, CAPS_USED.maxQuestions));
  log(`${questions.length} questions`);

  // --- both conditions, whole panel -------------------------------------
  const cards: DriftCard[] = [];
  const integrityAnswers: IntegrityAnswer[] = [];
  const panel = FREE_PANEL.slice(0, CAPS_USED.maxPanelModels);
  const total = questions.length * panel.length * 2;
  let done = 0;

  for (const [qi, question] of questions.entries()) {
    for (const model of panel) {
      for (const condition of ["MEMORY", "BROWSING"] as const) {
        done += 1;
        const answer =
          condition === "MEMORY"
            ? await answerFromMemory(model, domain, question, context)
            : await answerWithBrowsing(model, domain, question, context);
        records.push(...answer.records);

        if (!answer.text) {
          log(`   [${done}/${total}] ${condition} ${model.label} FAILED: ${answer.error?.slice(0, 70)}`);
          warnings.push(`${condition} answer failed for ${model.label}: ${answer.error}`);
          integrityAnswers.push({
            questionId: `q${qi}`,
            model: model.modelId,
            condition,
            claimCount: 0,
            retrievalCount: answer.retrieval.length,
            error: answer.error,
            rawText: null,
          });
          continue;
        }

        // A wholly hedging answer is the invisible regime, not drift.
        let claimTexts: string[] = [];
        if (isRefusal(answer.text)) {
          claimTexts = [answer.text.trim().slice(0, 200)];
        } else {
          const decomposed = await callObject(
            GEMINI_FLASH,
            ClaimBatchSchema,
            ClaimBatch,
            "You split an assistant's answer into atomic factual assertions, each quoted or closely paraphrased from the answer. Skip hedges, pleasantries and questions. Never correct or improve a claim — reproduce what was said.",
            `QUESTION\n${question}\n\nANSWER\n${answer.text}`,
            context,
          );
          records.push(decomposed.record);
          claimTexts = filterClaims(answer.text, decomposed.value.claims).claims.map(
            (c) => c.text,
          );
        }

        const slice = selectLedgerSlice(ledger, question, claimTexts, CAPS.LEDGER_SLICE);
        const ruled = await adjudicate(question, claimTexts, slice, context);
        records.push(...ruled.records);
        if (ruled.downgraded > 0) {
          warnings.push(`${ruled.downgraded} verdict(s) downgraded for invalid citations`);
        }

        integrityAnswers.push({
          questionId: `q${qi}`,
          model: model.modelId,
          condition,
          claimCount: claimTexts.length,
          retrievalCount: answer.retrieval.length,
          error: null,
          rawText: answer.text,
        });

        for (const verdict of ruled.verdicts) {
          const fact = ledger.find((f) => f.id === verdict.citedFactId);
          cards.push({
            id: `v${cards.length}`,
            question,
            questionCategory: fact?.category ?? "GENERAL",
            model: model.modelId,
            modelLabel: model.label,
            provider: model.provider,
            condition,
            latencyMs: answer.latencyMs,
            claimText: verdict.claimText,
            answerExcerpt: answer.text.slice(0, 400),
            ruling: verdict.ruling,
            confidence: verdict.confidence,
            reasoning: verdict.reasoning,
            downgraded: verdict.downgraded,
            groundTruth: fact
              ? {
                  id: fact.id,
                  statement: fact.statement,
                  category: fact.category,
                  evidenceSpan: fact.evidenceSpan,
                  sourceUrl: fact.sourceUrl,
                  pageTitle: null,
                }
              : null,
            evidenceQuote: verdict.evidenceQuote,
            searchQuery: answer.searchQuery,
            retrieval: answer.retrieval,
            remediation: null,
            weight: weightFor({
              ruling: verdict.ruling,
              citedFactCategory: fact?.category ?? null,
              questionCategory: fact?.category ?? null,
            }),
            askedAt: new Date().toISOString(),
            sourceCapturedAt: fact ? new Date().toISOString() : null,
          });
        }

        log(`   [${done}/${total}] ${condition.padEnd(8)} ${model.label.padEnd(20)} ${claimTexts.length} claims`);
      }
    }
  }

  // --- remediation ------------------------------------------------------
  const fixable = cards
    .filter((c) => (c.ruling === "DRIFTED" || c.ruling === "FABRICATED") && c.groundTruth)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, CAPS_USED.maxRemediations);

  log(`generating ${fixable.length} remediation patches`);
  for (const card of fixable) {
    const truth = card.groundTruth!;
    try {
      const result = await remediate(
        domain,
        card.question,
        card.claimText,
        {
          id: truth.id,
          statement: truth.statement,
          category: truth.category,
          evidenceSpan: truth.evidenceSpan,
          sourceUrl: truth.sourceUrl,
        },
        context,
      );
      records.push(...result.records);
      if (result.rejected) {
        warnings.push(`patch rejected: ${result.rejected}`);
        log(`   REJECTED: ${result.rejected}`);
        continue;
      }
      if (result.remediation) {
        card.remediation = {
          id: `r${card.id}`,
          kind: result.remediation.kind,
          content: result.remediation.content,
          targetUrl: result.remediation.targetUrl,
          rationale: result.remediation.rationale,
        };
        log(`   ${result.remediation.kind} for "${card.question.slice(0, 50)}"`);
      }
    } catch (error) {
      warnings.push(`remediation failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  // --- score and integrity ----------------------------------------------
  const scorables = cards.map((c) => ({
    ruling: c.ruling,
    citedFactCategory: c.groundTruth?.category ?? null,
    questionCategory: c.questionCategory,
  }));
  const score = parityScore(scorables);
  const wrong = wrongShare(scorables);
  const comp = composition(scorables);

  const integrity = checkScanIntegrity({
    pages: pages.map((p) => ({
      url: p.url,
      status: p.status,
      extractedText: p.chars > 0 ? "x".repeat(p.chars) : null,
    })),
    questions: questions.map((text, i) => ({ id: `q${i}`, text })),
    panelModels: panel.map((m) => m.modelId),
    answers: integrityAnswers,
    browsingEnabled: true,
  });

  const now = new Date().toISOString();
  const fixture = FixtureSchema.parse({
    fixtureVersion: FIXTURE_VERSION,
    slug,
    headline: headline ?? `Parity scan of ${domain}`,
    recordedAt: now,
    id: `scan-${slug}`,
    domain,
    mode: "DEMO",
    status: integrity.ok ? "COMPLETE" : "INCOMPLETE",
    parityScore: integrity.ok ? score : null,
    interpretation: interpret(score),
    claimsWrong: wrong.wrong,
    claimsCheckable: wrong.checkable,
    wrongHeadline: interpretWrongShare(wrong),
    composition: comp,
    warnings: [...new Set(warnings)].slice(0, 12),
    error: null,
    integrity: integrity.violations,
    createdAt: now,
    finishedAt: now,
    panel: panel.map((m) => ({ id: m.modelId, label: m.label, provider: m.provider })),
    pages: pages.map((p, i) => ({
      id: `p${i}`,
      url: p.url,
      title: p.title,
      status: p.status,
      httpStatus: null,
      error: null,
      factCount: ledger.filter((f) => f.sourceUrl === p.url).length,
      factsDropped: 0,
    })),
    facts: ledger.map((f) => ({
      id: f.id,
      statement: f.statement,
      category: f.category,
      evidenceSpan: f.evidenceSpan,
      sourceUrl: f.sourceUrl,
      pageTitle: null,
    })),
    questions: questions.map((text, i) => ({
      id: `q${i}`,
      text,
      category: "GENERAL",
      targetFactIds: [],
    })),
    runs: [
      {
        id: "run-0",
        index: 0,
        label: "Baseline",
        parityScore: score,
        composition: comp,
        driftCards: cards,
        answerCount: integrityAnswers.length,
        failedAnswerCount: integrityAnswers.filter((a) => a.error).length,
        startedAt: now,
        finishedAt: now,
      },
    ],
    remediations: cards.flatMap((c) => (c.remediation ? [c.remediation] : [])),
    cost: {
      lines: [],
      totalCalls: records.length,
      cachedCalls: records.filter((r) => r.cached).length,
      totalCostUsd: null,
    },
  });

  mkdirSync(join(process.cwd(), "fixtures"), { recursive: true });
  writeFileSync(
    join(process.cwd(), "fixtures", `${slug}.json`),
    `${JSON.stringify(fixture, null, 2)}\n`,
    "utf8",
  );

  const elapsed = ((Date.now() - started) / 1000 / 60).toFixed(1);
  console.log(`\nWrote fixtures/${slug}.json in ${elapsed} min`);
  console.log(`  facts        ${ledger.length}`);
  console.log(`  questions    ${questions.length}`);
  console.log(`  findings     ${cards.length}`);
  console.log(`  wrong        ${wrong.wrong}/${wrong.checkable}`);
  console.log(`  patches      ${fixture.remediations.length}`);
  console.log(`  calls        ${records.length} (${records.filter((r) => r.cached).length} cached)`);
  console.log(`  integrity    ${integrity.ok ? "ok" : `${integrity.violations.length} violation(s)`}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => process.exit(0));
