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
| 2 | Fact extraction with mandatory evidence spans | Gemini 3.1 Flash Lite |
| 3 | Question synthesis from the ledger | Gemini 3.1 Flash Lite |
| 4–5 | Panel answers the questions in both conditions. BROWSING injects snippets we retrieved ourselves, so every source the model saw is stored and shown | Panel |
| 6 | Claim decomposition | Gemini 3.1 Flash Lite |
| 7 | Evidence-forced adjudication against a retrieved ledger slice | Gemini 3.1 Flash Lite, or your own model under BYOK |
| 8 | Remediation: `llms.txt` patch, JSON-LD block, or rewritten page copy | Gemini 3.1 Flash Lite |

Two invariants are enforced in code rather than asked for in a prompt:

- **A fact is never stored without a verified evidence span.** After extraction, every
  span is re-located verbatim in the source text under normalisation. If it cannot be
  found, the fact is dropped and counted — never persisted unverified.
- **A `CONFIRMED` or `DRIFTED` verdict cannot cite a fact the adjudicator was not
  shown.** Citations are validated after the call; a verdict that fails is downgraded to
  `UNSUPPORTED` and flagged.

---

## Three ways to run it

| Mode | What you need | What you get |
|---|---|---|
| **Demo** | nothing | `/demo` — real scans, recorded and frozen. Served from disk with no database, network, or quota. |
| **Free** | nothing | A live scan on free-tier models. 5 pages, 8 questions, one model, both conditions. Remaining quota is shown honestly. |
| **BYOK** | your API key | Full crawl, full panel, frontier models. The key is used for that one scan and never stored. |

Your key is accepted over POST, held in memory for the request, never written to the
database, never logged, never included in an error message, and never part of a cache
key. If a scan is served partly from cache, every such call is marked `cached` in the
cost breakdown so you can see what you did not pay for.

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
cp .env.example .env.local   # DATABASE_URL, DIRECT_URL, and the free-tier keys
pnpm db:migrate
pnpm dev
```

Visit `/health` to confirm the database, both panel models, and search access are live.
It calls each provider for real on every request, so a withdrawn free-tier model shows
up as a failed check rather than as empty answers inside a scan.

| Command | |
|---|---|
| `pnpm dev` | Dev server |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm test` | Unit tests |
| `pnpm db:migrate` | Apply migrations |
| `pnpm demo:record` | Freeze a completed scan as a `/demo` fixture |

---

## Deploy

Vercel, importing this repository. The build command is already correct
(`prisma generate && next build`) and needs no configuration.

Set these in the Vercel project's environment variables:

| Variable | Needed for |
|---|---|
| `DATABASE_URL` | pooled Neon URL — live scans |
| `DIRECT_URL` | unpooled Neon URL — migrations |
| `GOOGLE_GENERATIVE_AI_API_KEY` | free-tier panel and adjudicator |
| `GROQ_API_KEY` | free-tier panel |
| `TAVILY_API_KEY` | the browsing condition |

The build succeeds with none of them set — `/`, `/demo`, `/study` and
`/pricing` are static or SSG and touch neither the database nor a provider.
Only live scans and `/health` need credentials, which is deliberate: the
demo path must not be able to fail because a key is missing.

`/demo` and `/demo/[slug]` are prerendered from `fixtures/*.json` at build
time, so **adding a fixture requires a redeploy** for it to appear.

---

## Limitations

Stated plainly, because a tool that audits other systems for accuracy should be honest
about its own.

> **A note on which models we test, because it is a design choice rather than a
> constraint we regret.**
>
> Parity's public panel is Gemini 3.1 Flash Lite and Qwen 3.8 27B. Neither is a
> frontier model, and we do not claim "the best models get this wrong."
>
> We claim something we think matters more. Small, fast, cheap models are what
> actually answer at scale: they are what sits behind in-product assistants,
> support bots, RAG pipelines, autocomplete, routing layers and agent subtasks,
> because those workloads are latency- and cost-bound. When a customer's question
> about your pricing gets answered by software rather than by a person, a model in
> this class is more likely to be the one answering than a frontier model is.
>
> So this panel is not a cheaper approximation of the real test. For deployed
> assistants and agents it *is* closer to the real test. A frontier model is the
> better proxy for a human deliberately researching you in a chat window; these are
> the better proxy for the automated surface that answers everyone else.
>
> Both are worth auditing, and they fail differently. Bring your own key to run the
> identical question set against Claude or GPT and compare the two directly.

- **Free-tier rate limits shape the results.** Groq enforces 6,000 tokens/minute and a
  separate 1,000 output-tokens/minute ceiling; Gemini's free tier is request-limited
  rather than token-limited. Token-heavy work is routed to Gemini, Groq answers are
  kept short, and throttling is surfaced in the scan UI as a real state rather than
  hidden behind a spinner.
- **The adjudicator is a language model judging language models.** Verdicts are forced
  to cite a ledger entry and validated against it, which bounds the failure mode but
  does not eliminate it. On a fast adjudicator, expect roughly one misruling in six —
  we have seen a correctly-supported claim ruled DRIFTED. Every verdict shows the exact
  span it was decided against, so a reader can check the ruling rather than trust it.
  Confidence scores are the model's own and are not calibrated.
- **The ledger is only as good as the crawl.** Capped at 25 pages, text-only — no
  headless browser, so content rendered entirely client-side is largely invisible. This
  is measurable: crawling `github.com/pricing` yields ~2,100 characters and 9 facts,
  because most of that page is rendered in the browser. A site whose pricing is
  client-side will look sparser than it is. A page that returns 403 or is disallowed by
  `robots.txt` is reported as such, never silently skipped, and a page that extracts to
  nothing usable fails the integrity check rather than quietly scoring.
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
