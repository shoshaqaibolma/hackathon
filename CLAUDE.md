# CLAUDE.md — Parity

Read `PLAN.md` for architecture. This file is conventions and guardrails.

Parity audits whether AI assistants state **true** things about a company's site, and
emits the fix. Hackathon build, solo, deadline **Tue 15 Sep 2026 23:00 EDT**. The prize
is "Best SaaS Product" — every decision is weighed against *"does this look and behave
like something a person would pay for?"*

---

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Next dev server on :3000 |
| `pnpm build` | `prisma generate && next build` |
| `pnpm typecheck` | `tsc --noEmit` — **must pass before any phase is called done** |
| `pnpm lint` | ESLint — **must pass before any phase is called done** |
| `pnpm test` | Unit tests (`lib/score.ts`, `lib/crawl/prioritise.ts`) |
| `pnpm db:push` | `prisma db push` — fast iteration on schema |
| `pnpm db:migrate` | `prisma migrate dev` — use once the schema settles |
| `pnpm db:studio` | Prisma Studio |
| `pnpm db:seed` | Load `fixtures/demo-scan.json` into the DB for `/demo` |

Package manager is **pnpm**, via corepack. Never `npm install` / `yarn`.

---

## Stack — fixed, do not substitute

Next.js 15 App Router · TypeScript **strict** · Tailwind + shadcn/ui · Postgres via
Prisma (Neon) · Vercel AI SDK (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`) with
`generateObject` + zod for every structured step · `undici` + `@mozilla/readability` +
`jsdom` for crawling · SSE route handlers read client-side with a `ReadableStream`
reader · deployed on Vercel.

Plus **Vitest** (devDependency, approved at Phase 0) as the test runner.

**Ask before adding any dependency not on that list.** shadcn/ui's own transitive
packages (radix, `clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react`)
are part of shadcn and do not need a separate ask.

**Model roles** (`lib/llm/models.ts`): `FAST` = `claude-haiku-4-5`,
`WRITER` = `claude-sonnet-5`, `JUDGE` = `claude-opus-5`.
**Panel under test** = `claude-sonnet-5` + `claude-haiku-4-5` (Anthropic only). A third
OpenAI panel slot exists but is off unless `PANEL_OPENAI_MODEL` is set.

---

## Do not

- **Do not use Playwright or any headless browser.** Too slow, will not run on Vercel.
- **Do not write a `Fact` without a verified `evidenceSpan`.** The span must be
  re-located verbatim in `Page.extractedText` under normalisation. If it cannot be,
  the fact is dropped and counted — never stored unverified.
- **Do not let a `CONFIRMED` or `DRIFTED` verdict exist without a real `citedFactId`**
  that was present in the ledger slice the adjudicator was shown. Validate after the
  call; downgrade to `UNSUPPORTED` and flag if it fails.
- **Do not make a model call outside `lib/llm/call.ts`.** Everything goes through the
  `LlmCache`. Re-running the same call twice in development must cost $0.
- **Do not cache panel answers on a re-run** (`Run.index > 0`). That would make the
  before/after score diff inert while appearing to work. See PLAN §7.
- **Do not mock anything that can actually be built.** The single exception is the
  `/demo` fixture, and even that is a *recorded real scan*, not invented data.
- **Do not swallow failures.** A 403, a robots disallow, an empty extraction, a model
  5xx, a schema violation — each becomes a persisted status and a visible UI state.
- **Do not build auth, billing, multi-tenancy, or scheduled re-scans.** Out of scope.
  The pricing page is marketing copy with no checkout behind it.
- **Do not commit secrets.** `.env.local` is gitignored; `.env.example` is committed
  with empty values.
- **Do not use a strong model where a fast one will do.** `claude-opus-5` is for
  adjudication only. Everything else is `claude-haiku-4-5`, except remediation copy
  (`claude-sonnet-5`).
- **Do not exceed the caps**: 25 pages crawled, 40 questions, concurrency 6.
- **Do not reintroduce `DRIFTED = 0`.** It is `-0.5`, deliberately amending the original
  spec so that drift scores below the neutral line and absence sits on it. See PLAN §6.

---

## Conventions

**TypeScript.** `strict: true`, no `any`, no non-null `!` outside tests. Prefer
`type` over `interface`. Zod schemas live in `lib/schemas.ts` and are **named
exports whose variable name matches the string passed as `schemaName`** to the LLM
wrapper — that string is part of the cache key, so renaming one invalidates its cache
deliberately.

**Server vs client.** Default to server components. `"use client"` only for the scan
progress stream, the drift-card interactions, and form inputs. Data access is Prisma
in server components or route handlers; never a client-side DB call.

**Config.** Every tunable — model IDs, page cap, question cap, concurrency, phase
budget, severity weights, verdict scores — lives in `lib/config.ts`. No magic numbers
scattered through the pipeline.

**Pure functions get tests.** `lib/score.ts` and `lib/crawl/prioritise.ts` are pure and
tested. The rest is integration-checked by running a real scan.

**Errors.** Typed error classes in `lib/errors.ts`. Route handlers convert them to SSE
`{ type: "error", stage, message, recoverable }` events. The UI renders them; it never
renders a blank.

**SSE event shape.** One discriminated union, defined once, shared by server and
client:
`{ type: "phase_start" | "progress" | "item" | "warning" | "error" | "phase_paused" | "phase_done", ... }`

**Naming.** Files kebab-case. Components PascalCase. DB enums SCREAMING_SNAKE.
Pipeline stage functions are verbs: `extractFacts`, `synthesiseQuestions`,
`interrogate`, `decomposeClaims`, `adjudicate`, `remediate`.

---

## Git

Conventional commits, one commit per phase minimum:
`feat(crawl): ...`, `feat(pipeline): ...`, `fix(score): ...`, `chore: ...`,
`docs: ...`.

Commit messages end with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018cH3TGRVzA1AQErTcJ8t7G
```

---

## Phase discipline

Phases 0–5 are defined in `PLAN.md` §9. **Stop at every checkpoint and hand back.**
Before declaring a phase done: `pnpm typecheck` and `pnpm lint` both pass (actually
run them, don't assume), the phase's user-visible checkpoint works, and the work is
committed.

---

## The drift card

`components/drift-card.tsx` is the single most important object in the product. It is
what a judge sees in a screenshot. Its anatomy is fixed:

```
┌──────────────────────────────────────────────────────────────┐
│  "Does Parity's Pro plan include API access?"   [ DRIFTED ]  │
│  claude-sonnet-5 · BROWSING · 2.4s                           │
├───────────────────────────────┬──────────────────────────────┤
│  GROUND TRUTH · YOUR PAGE     │  MODEL CLAIM                 │
│  "Pro includes 10,000 API     │  "The Pro plan comes with    │
│   calls per month."           │   unlimited API access."     │
│  parity.dev/pricing ↗         │  confidence 0.91             │
├───────────────────────────────┴──────────────────────────────┤
│  SUGGESTED FIX · llms.txt                      [ Copy ]      │
│  ## Pricing                                                  │
│  Pro — $49/mo — 10,000 API calls/month (not unlimited)       │
└──────────────────────────────────────────────────────────────┘
```

Left pane is always the quoted `evidenceSpan` plus its `sourceUrl`. Right pane is
always the model's literal words. Never paraphrase either side — the credibility of
the entire product rests on both panes being verbatim.

---

## Working with me

- If something in the spec turns out to be wrong once you are in the code, **say so and
  propose the alternative** — do not quietly do something else.
- Ship the whole phase. If part is blocked, finish the rest and say exactly what was
  left out and why.
- Honest reporting: if a test fails or a step was skipped, say it plainly with the
  output.
