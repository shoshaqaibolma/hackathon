# Parity

**Every AEO tool measures whether AI assistants *mention* your company. Parity measures whether what they say is *true* — and emits the fix.**

Give Parity a domain. It crawls the site into a ledger of atomic facts, each one stored
with its source URL and the exact quoted span it came from. It synthesises the questions
a real customer would ask an assistant about that company, puts them to a panel of models
in two conditions — parametric memory and web search — decomposes every answer into
atomic claims, and adjudicates each claim against the ledger. Then it generates the
remediation and re-runs the identical question set to prove the score moved.

---

## Why the two conditions matter

Asking the same question with and without web search is the whole diagnostic:

| MEMORY | BROWSING | Diagnosis |
|---|---|---|
| wrong | right | The models' training data is stale. Your current site is fine. |
| wrong | wrong | **Your site is wrong**, or says nothing on the subject. |
| right | wrong | Something outranking you is contradicting you. |
| right | right | You have parity. |

No other tool in this category reports that split, and it is the difference between
"rewrite your pricing page" and "you have a visibility problem".

---

## The Parity Score

```
weight:  PRICING 3, ELIGIBILITY 3, LIMITS 2, COMPATIBILITY 2, API 2, GENERAL 1
score:   CONFIRMED +1, DRIFTED -0.5, UNSUPPORTED 0, FABRICATED -1
Parity = clamp(0, 100, 50 + 50 × Σ(weight × score) / Σ(weight))
```

Read it against the midpoint:

- **Above 50** — models get you right.
- **Around 50** — models don't know you.
- **Below 50** — models are confidently wrong about you.

Errors are weighted by commercial harm, so a fabricated price outranks a wrong founding
date. The formula is one pure function in [`lib/score.ts`](lib/score.ts) with unit tests.

---

## How it works

| Step | What happens | Model |
|---|---|---|
| 1 | `robots.txt` + sitemap discovery, deterministic URL prioritisation, fetch, Readability extraction | — |
| 2 | Fact extraction with mandatory evidence spans | Claude Haiku 4.5 |
| 3 | Question synthesis from the ledger | Claude Haiku 4.5 |
| 4–5 | Panel answers the questions in both conditions | Panel |
| 6 | Claim decomposition | Claude Haiku 4.5 |
| 7 | Evidence-forced adjudication against a retrieved ledger slice | Claude Opus 5 |
| 8 | Remediation: `llms.txt` patch, JSON-LD block, or rewritten page copy | Claude Sonnet 5 |

Two invariants are enforced in code rather than asked for in a prompt:

- **A fact is never stored without a verified evidence span.** After extraction, every
  span is re-located verbatim in the source text under normalisation. If it cannot be
  found, the fact is dropped and counted — never persisted unverified.
- **A `CONFIRMED` or `DRIFTED` verdict cannot cite a fact the adjudicator was not
  shown.** Citations are validated after the call; a verdict that fails is downgraded to
  `UNSUPPORTED` and flagged.

---

## Stack

Next.js 15 (App Router) · TypeScript strict · Tailwind CSS 4 + shadcn/ui ·
Postgres via Prisma 7 (Neon) · Vercel AI SDK 7 · `undici` + `@mozilla/readability` +
`jsdom` · SSE progress streaming · deployed on Vercel.

Every model call is cached by `sha256(namespace | model | schema | system | prompt |
toolset)`, so re-running a scan during development costs nothing.

---

## Setup

```bash
pnpm install
cp .env.example .env.local   # fill in DATABASE_URL, DIRECT_URL, ANTHROPIC_API_KEY
pnpm db:migrate
pnpm dev
```

Visit `/health` to confirm the database, the models, and web-search access are all live.

| Command | |
|---|---|
| `pnpm dev` | Dev server |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm test` | Unit tests |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:seed` | Load the `/demo` fixture |

---

## Limitations

Stated plainly, because a tool that audits other systems for accuracy should be honest
about its own.

- **A same-provider panel has correlated failure modes.** The default panel is Claude
  Sonnet 5 and Claude Haiku 4.5 — two models from one family, sharing training data,
  tokenizer, and post-training lineage. When they agree, that agreement is **weaker
  evidence than it appears**: they can be wrong in the same direction for the same
  reason, and a shared blind spot will read as consensus. Cross-provider disagreement
  would be a far stronger signal. Setting `PANEL_OPENAI_MODEL` adds a third,
  independent member. The MEMORY vs BROWSING axis does not have this problem and
  carries most of the diagnostic weight.
- **The adjudicator is a language model judging language models.** Verdicts are forced
  to cite a ledger entry and validated against it, which bounds the failure mode but
  does not eliminate it. Confidence scores are the model's own and are not calibrated.
- **The ledger is only as good as the crawl.** Capped at 25 pages, text-only — no
  headless browser, so content rendered entirely client-side is invisible to it. A page
  that returns 403 or is disallowed by `robots.txt` is reported as such, never silently
  skipped.
- **Browsing answers are not reproducible.** The live web moves. A re-run days later
  legitimately differs, and the cache namespace exists to make that explicit rather
  than to hide it.
- **Questions are synthesised, not observed.** They approximate what a customer would
  ask; they are not sampled from real assistant traffic.
- **Score comparisons are only meaningful within one scan.** Two domains produce
  different question sets and different ledgers, so their Parity Scores are not
  directly comparable.

---

## Scope

No auth, no billing, no multi-tenancy, no scheduled re-scans. The pricing page is
marketing copy with nothing behind it. Built for a hackathon.
