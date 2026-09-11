# Parity — Architecture & Build Plan

> Every AEO tool measures whether AI assistants **mention** you.
> Parity measures whether what they say is **true**, and emits the fix.

**Deadline:** Tue 15 Sep 2026, 23:00 EDT. **Today:** Sat 12 Sep 2026.
**Prize:** Best SaaS Product — it must read as a product, not a research demo.

---

## 1. Judge-weight mapping

| Weight | Criterion | Where we win it |
|---|---|---|
| 25% | Technical Implementation | Mechanically-enforced evidence spans, evidence-forced adjudication with post-hoc citation validation, a resumable work-queue pipeline that survives serverless timeouts, a pure tested scoring function, full LLM response cache |
| 25% | Problem & Impact | The MEMORY vs BROWSING delta separates *"your site is wrong"* from *"your site is invisible"* — nobody else reports this. Errors are severity-ranked by commercial category (pricing/eligibility first) |
| 20% | Innovation | Step 6: the closed loop. Generate the patch, re-run the identical question set, show the score move |
| 15% | UX/Design | The drift card. One screenshot must carry the product |
| 15% | Demo | `/demo` serves a frozen real scan from Postgres — zero cold-API risk on stage |

---

## 2. The one architectural problem worth solving up front

A full scan is ~330 model calls. A Vercel function cannot run that in one request
(300s on Fluid Hobby, 800s Pro). Streaming SSE does not extend the limit — it only
keeps the socket warm while the *same* function burns its budget.

**Solution: every pipeline step is a resumable work queue backed by Postgres.**

- Each phase route drains *pending work units* until a wall-clock budget
  (`PHASE_BUDGET_MS`, default 45s local / 240s on Vercel) is exhausted, then closes
  the SSE stream with a terminal `{ type: "phase_paused", more: true }` event.
- The client orchestrator re-opens the stream for the same phase until `more: false`,
  then advances to the next phase.
- "Pending work unit" is always a DB query, never in-memory state: pages without
  facts, questions without answers, answers without verdicts. So a crash, a redeploy,
  a closed laptop, or a timeout costs at most one work unit.

This is also what makes the Phase 4 re-run cheap: it is the same queue with a new
`Run` row.

```
POST /api/scan                      -> { scanId }   (creates Scan, status=QUEUED)
GET  /api/scan/:id/run?phase=crawl        SSE, resumable
GET  /api/scan/:id/run?phase=facts        SSE, resumable
GET  /api/scan/:id/run?phase=questions    SSE, resumable
GET  /api/scan/:id/run?phase=interrogate  SSE, resumable   <- the long one
GET  /api/scan/:id/run?phase=adjudicate   SSE, resumable
GET  /api/scan/:id/run?phase=score        fast
GET  /api/scan/:id/run?phase=remediate    SSE, resumable
POST /api/scan/:id/rerun            -> { runId }   then replay interrogate..score
GET  /api/scan/:id                  -> JSON snapshot (dashboard hydration)
```

---

## 3. File layout

```
parity/
  app/
    layout.tsx  page.tsx                 landing (Phase 5)
    pricing/page.tsx                     three tiers (Phase 5)
    health/page.tsx                      Phase 1 checkpoint: db + env + model reachability
    demo/page.tsx                        frozen real scan, no API calls
    scan/[id]/page.tsx                   progress -> dashboard
    api/health/route.ts
    api/scan/route.ts                    POST create
    api/scan/[id]/route.ts               GET snapshot
    api/scan/[id]/run/route.ts           GET SSE phase driver
    api/scan/[id]/rerun/route.ts         POST new Run
  components/
    drift-card.tsx                       *** the single most important object ***
    ledger-table.tsx  score-dial.tsx  score-diff.tsx
    scan-progress.tsx  patch-block.tsx  failure-banner.tsx
    ui/                                  shadcn primitives
  lib/
    config.ts                            models, caps, weights, budgets — one place
    db.ts                                Prisma singleton
    schemas.ts                           every zod schema, named (names are cache keys)
    concurrency.ts                       hand-rolled pLimit (~15 lines, no dep)
    errors.ts                            typed failure states surfaced to UI
    score.ts  score.test.ts              pure + tested
    llm/
      models.ts                          model registry + panel definition
      cache.ts                           LlmCache read/write, namespacing, bypass
      call.ts                            cached generateObject / generateText wrappers
      websearch.ts                       provider-specific web-search tool wiring
    crawl/
      discover.ts                        robots.txt + sitemap.xml + homepage links
      prioritise.ts  prioritise.test.ts  pure, deterministic URL ranking
      fetch.ts                           undici, timeouts, honest error classes
      extract.ts                         jsdom + Readability -> text
    pipeline/
      runner.ts                          phase state machine + work-queue drain loop
      facts.ts  questions.ts  interrogate.ts  claims.ts  adjudicate.ts  remediate.ts
      retrieve.ts                        ledger slice selection for the adjudicator
  prisma/
    schema.prisma  seed.ts
  fixtures/demo-scan.json                a REAL recorded scan, committed
```

---

## 4. Data model

Spec schema, with four deltas I think are required. Everything else is as written.

### Delta 1 — `Run` (required for Phase 4 to work at all)

The spec hangs `Answer` off `Question`. A before/after diff needs two answer sets for
the same question set. Without this, Phase 4 cannot be built.

```prisma
model Run {
  id          String    @id @default(cuid())
  scanId      String
  index       Int       // 0 = baseline, 1 = after remediation
  label       String    // "Baseline" | "After patches"
  parityScore Float?
  startedAt   DateTime  @default(now())
  finishedAt  DateTime?
  answers     Answer[]
}
```

`Answer` gains `runId`. `Scan.parityScore` mirrors the latest run's score.

### Delta 2 — `Verdict.citedFactId` is nullable

FABRICATED and UNSUPPORTED verdicts by definition cite nothing. The schema must allow
it, and the validator must *require* a fact id for CONFIRMED and DRIFTED.
`Verdict` also gains `evidenceQuote` (the span the adjudicator leaned on) — the drift
card's left pane renders this, not the whole fact.

### Delta 3 — severity weight for uncited verdicts

The formula weights by *fact category*, but FABRICATED/UNSUPPORTED verdicts have no
fact. Resolution order, implemented in `score.ts`:

1. category of `citedFactId`, else
2. modal category of the parent `Question.targetFactIds`, else
3. `GENERAL` (weight 1).

### Delta 4 — honest failure state

`Page.status` (`OK | HTTP_ERROR | BLOCKED_BY_ROBOTS | EXTRACT_EMPTY | TIMEOUT`) +
`Page.error`. `Answer.error`, `Scan.warnings String[]`. A 403 shows up in the UI as a
403, never as a missing row.

Additions elsewhere: `Fact.evidenceVerified Boolean`, a dropped-fact counter surfaced
on the ledger page; `Remediation.targetUrl`, `Remediation.rationale`;
`LlmCache.namespace` (see §7).

---

## 5. Exact model-call sequence

Registry (`lib/llm/models.ts`) — IDs verified against the current model table, not memory:

| Role | Model | $/1M in | $/1M out |
|---|---|---|---|
| `FAST` — extraction, questions, claim decomposition | `claude-haiku-4-5` | 1.00 | 5.00 |
| `WRITER` — remediation copy | `claude-sonnet-5` | 2.00 | 10.00 |
| `JUDGE` — adjudication only | `claude-opus-5` | 5.00 | 25.00 |
| Panel A (under test) | `claude-sonnet-5` | — | — |
| Panel B (under test) | OpenAI flagship — exact ID confirmed at Phase 3 | — | — |
| Panel C (optional, env-gated) | `claude-haiku-4-5` | — | — |

| # | Step | Model | AI SDK call | Calls / scan | Schema |
|---|---|---|---|---|---|
| 1 | URL triage *(only when sitemap is missing or >200 URLs)* | FAST | `generateObject` | 0–1 | `UrlTriage` |
| 2 | Fact extraction, 1 call per page | FAST | `generateObject` | ≤25 | `FactBatch` |
| 3 | Question synthesis, chunked by category | FAST | `generateObject` | 2–4 | `QuestionBatch` |
| 4 | Answer · MEMORY (tools explicitly disabled) | Panel | `generateText` | Q × M | — raw prose |
| 5 | Answer · BROWSING (web-search server tool) | Panel | `generateText` + tool | Q × M | — raw prose |
| 6 | Claim decomposition, 1 call per answer | FAST | `generateObject` | = answers | `ClaimBatch` |
| 7 | **Adjudication**, all claims of one answer per call | JUDGE | `generateObject` | = answers | `VerdictBatch` |
| 8 | Remediation, top-N severity-ranked verdicts | WRITER | `generateObject` | ≤12 | `RemediationPatch` |

Defaults: **Q = 24 questions, M = 2 models, 2 conditions → 96 answers.** Caps are
`config.ts` constants; the spec's 40-question ceiling is the hard max.

### Two constraints that shape steps 4–7

**(a) `generateObject` cannot carry a server-side web-search tool.** Structured output
and tool loops are mutually exclusive in the AI SDK. This is *fine* — the panel should
answer in prose anyway (`Answer.rawText` is the spec). So steps 4–5 are `generateText`,
and decomposition (step 6) is a separate structured call over that text. This also
keeps the panel's job identical to what a real user experiences.

**(b) The MEMORY condition must be provably tool-free.** Some providers search by
default. `lib/llm/websearch.ts` owns this: BROWSING declares the provider's web-search
server tool; MEMORY passes no tools *and* a system instruction forbidding speculation
about live data. The condition label on the drift card has to be trustworthy.

### Evidence enforcement — mechanical, not trusted

- **Facts.** After step 2, every `evidenceSpan` is re-located verbatim in
  `Page.extractedText` under normalisation (collapse whitespace, fold smart quotes,
  case-insensitive). Miss → one repair retry demanding the literal span → still miss →
  the fact is **dropped** and counted. *A fact with no verified evidence span is never
  written to the DB.*
- **Verdicts.** After step 7, any CONFIRMED/DRIFTED verdict whose `citedFactId` is not
  in the ledger slice it was shown is **downgraded to UNSUPPORTED** and flagged. The
  adjudicator cannot cite a fact it was not given.

### Adjudicator input is a ledger *slice*, not the ledger

`retrieve.ts`: the question's `targetFactIds` ∪ top-K by lexical overlap with the
answer text, capped at ~25 facts. Keeps the judge call at ~5k input tokens and
prevents "I found a different fact that vaguely supports this".

---

## 6. Scoring — `lib/score.ts`, pure, unit-tested

```
weight:  PRICING 3, ELIGIBILITY 3, LIMITS 2, COMPATIBILITY 2, API 2, GENERAL 1
score:   CONFIRMED +1, DRIFTED 0*, UNSUPPORTED 0, FABRICATED -1
Parity = clamp(0, 100, 50 + 50 * Σ(weight × score) / Σ(weight))
```

Tests cover: all-confirmed → 100; all-fabricated → 0; empty verdict set → `null`
(not 50 — "no data" is not "neutral", and the UI must say so); weight resolution
through all three fallback tiers; clamping; a hand-computed mixed fixture.

**\* One recommendation, flagged rather than silently applied.** DRIFTED scoring 0 means
a site whose facts are being mangled everywhere returns a Parity Score of exactly 50 —
the same as a site the models have never heard of. Those are the two failure modes the
product exists to *distinguish*, and the headline number would collapse them. I
recommend **DRIFTED = −0.5**: drift pushes below the neutral line, absence sits on it.
Shipping the spec value (0) as the default; it is one constant in `score.ts`, so say
the word either way.

---

## 7. Cost, latency, caching

**Every model call goes through `LlmCache`.**
Key = `sha256(namespace | model | schemaName | systemPrompt | userPrompt | toolset)`.

**The cache has one trap that would silently break the money feature.** If a Phase 4
re-run hits the cache for steps 4–5, it replays the *original* answers and the score
cannot move — the closed loop would look like it works and be inert. So:
`Run.index > 0` sets `bypassCache` on panel calls only. Steps 2, 3, 6 stay cached
(deterministic over unchanged input); step 7 is re-keyed by the new answer text
naturally. Browsing calls also carry a `namespace` so the whole cache can be rolled
forward with one env bump when the web changes.

**Cold full scan, estimated:**

| Step | Calls | Est. cost |
|---|---|---|
| Fact extraction (Haiku) | 25 | $0.34 |
| Questions (Haiku) | 3 | $0.02 |
| Panel answers incl. web-search tool fees | 96 | ~$1.50 |
| Claim decomposition (Haiku) | 96 | $0.32 |
| Adjudication (Opus 5) | 96 | ~$7.20 |
| Remediation (Sonnet 5) | 12 | $0.25 |
| **Total** | **~328** | **~$9.60** |

Warm re-run (cache hit on everything but the panel): **~$1.50**.
`ADJUDICATOR_MODEL=claude-sonnet-5` drops a cold scan to **~$3.30** if the bill bites.

**Latency.** Concurrency 6 across the panel fan-out; browsing calls dominate at
15–40s each. Expect a cold scan in 4–7 minutes wall clock, streamed the whole way,
spread over several resumable phase requests. The progress UI turns that into a
feature rather than a wait.

**Crawl discipline.** 25 pages max. Deterministic priority score in `prioritise.ts`:
sitemap presence, then URL-pattern bonuses (`/pricing` `/plans` > `/docs` `/api`
`/faq` `/changelog` `/limits` `/compare` > depth penalty > everything else). Model
triage only breaks ties when no sitemap exists. `robots.txt` is respected; a
disallow is reported, not worked around.

---

## 8. Failure semantics

Every failure becomes a row and a UI state, never a silent drop: crawl 403, robots
disallow, JS-only page with empty extraction, model call 5xx after 2 retries,
structured-output schema violation after 1 repair retry. The scan page carries a
`failure-banner` and the ledger shows "*N of 25 pages unreadable*" with reasons. A
scan with warnings still scores, and the score panel states its denominator.

---

## 9. Phase checklist

- **0 — Plan.** `PLAN.md`, `CLAUDE.md`. ← you are here
- **1 — Skeleton + deploy.** Next 15 + TS strict + Tailwind + shadcn, Prisma schema &
  migration against Neon, `/health` proving db + env + a live model ping, green
  `typecheck`/`lint`, deployed to Vercel, live URL handed over.
- **2 — Crawl + ledger.** discover → prioritise → fetch → extract → facts with enforced
  spans. Ledger UI: statement, category chip, quoted span, source link, drop count.
- **3 — Interrogation + adjudication.** Questions, panel fan-out ×2 conditions, claim
  decomposition, evidence-forced adjudication with citation validation, `score.ts` +
  tests. Full scan end to end. **The technical heart — the care goes here.**
- **4 — Remediation + re-test.** `llms.txt` / JSON-LD / page-copy patches, one-click
  re-run on the same question set, before/after diff.
- **5 — Product.** Landing, onboarding, streaming progress, dashboard, pricing, and
  the drift card polished until a single screenshot sells it.

`/demo` is seeded from a **real recorded scan** committed to `fixtures/demo-scan.json`
— not hand-written fake data. Recorded at the end of Phase 4.

---

## 10. Open questions for you

1. **Test runner.** `score.ts` needs unit tests and nothing on the approved stack can
   run them. Requesting **Vitest** (devDependency only). Alternative: Node's built-in
   `node:test` + `tsx` — zero framework, slightly clunkier. Your call.
2. **Panel composition.** Default is Claude Sonnet 5 + one OpenAI flagship (cross-provider
   is a better story and a better signal). Confirm you want OpenAI in, and that an
   `OPENAI_API_KEY` will exist — otherwise the panel degrades to two Anthropic models.
3. **DRIFTED weight** — spec's 0, or my recommended −0.5? (§6)
4. **Neon.** I need a `DATABASE_URL` (pooled) and `DIRECT_URL` (unpooled, for migrations)
   before Phase 1 can finish. Plus `ANTHROPIC_API_KEY`, and a Vercel account/project.

Small things I am deciding myself unless you object: concurrency limiter hand-rolled
rather than adding `p-limit`; sitemap parsed with a regex rather than adding
`fast-xml-parser`; score-diff chart drawn as inline SVG rather than adding a chart
library. All three avoid a dependency request for ~40 lines of code.
