# What AI assistants get wrong about developer tools

**A measured study of 11 developer-tool and SaaS websites.**

We asked a language model questions a prospective customer would ask about each
company, then checked every factual claim in its answers against the company's
own website — quoting the exact span the check was made against.

**Across 11 companies, 43 of 102 checkable claims were wrong: 42%.**
The median company had **45%** of claims about it stated incorrectly.

Scanned 2026-09-12. Every number here is reproducible from this repository.

---

## Results

Ranked by the share of checkable claims that were wrong — the headline number,
because it is the one that does not move when ledger coverage changes.

| Company | Claims wrong | | Parity Score | Facts checked | Pages |
|---|---|---|---|---|---|
| dropbox.com | **71%** | 5/7 | 21.4 | 18 | 3 |
| heroku.com | **67%** | 4/6 | 29.2 | 16 | 3 |
| railway.app | **67%** | 6/9 | 36.1 | 21 | 3 |
| github.com | **60%** | 6/10 | 32.5 | 9 | 3 |
| supabase.com | **50%** | 6/12 | 43.8 | 15 | 3 |
| vercel.com | **45%** | 5/11 | 52.3 | 22 | 3 |
| planetscale.com | **33%** | 4/12 | 47.9 | 19 | 3 |
| render.com | **33%** | 3/9 | 50.0 | 14 | 3 |
| replit.com | **29%** | 2/7 | 57.1 | 15 | 3 |
| fly.io | **25%** | 2/8 | 50.0 | 15 | 3 |
| notion.so | **0%** | 0/11 | 68.2 | 17 | 3 |

**Parity Score** is the weighted aggregate: pricing and eligibility errors count
triple, limits and API errors double. It is bounded above by how much of a
question the site's own text actually addresses, so a company can score in the
sixties with a perfect record — see Notion below.

---

## What the two extremes show

**Notion — 0% wrong, and still only 68.2.** Every checkable claim the model made
was correct: 7-day version history on the free plan, 90 days on Business, the
30-day annual refund window, free Plus for students. The score sits at 68 because
several answers wandered into territory Notion's pricing page does not address,
which scores as UNSUPPORTED rather than as an error. This is the clearest
demonstration that the score measures rather than manufactures: given a company
the model genuinely knows, it finds nothing wrong.

**Dropbox — 71% wrong.** The most-wrong company in the study, on plan names,
storage allowances and per-user prices that are published plainly on their own
pricing page.

---

## Method

1. **Crawl.** Discover URLs via `robots.txt`, sitemap and homepage links; rank
   them deterministically, favouring pricing, limits, eligibility and API pages;
   fetch the top 3 and extract text with Readability. No headless browser.
2. **Build a ledger.** Extract atomic, checkable facts from each page. **Every
   fact must carry an evidence span that is re-located verbatim in the stored
   page text.** A span that cannot be found is dropped, never repaired — so no
   claim in this study is checked against a paraphrase.
3. **Ask.** Synthesise four questions a prospective customer would ask, each
   naming the company, and put them to the model from parametric memory only.
4. **Adjudicate.** Compare each assertion in the answer against the ledger and
   rule it CONFIRMED, DRIFTED, FABRICATED or UNSUPPORTED, citing the fact relied
   on. A citation the adjudicator was not shown is rejected and downgraded.

**Panel.** Qwen 3.8 27B answered; Gemini 3.1 Flash Lite extracted and
adjudicated. Both are small, fast models — deliberately. Models in this class are
what sit behind in-product assistants, support bots, RAG pipelines and agent
subtasks, because those workloads are latency- and cost-bound. For the automated
surface that answers most customers, this is closer to the real test than a
frontier model would be.

**Scope.** 3 pages and 4 questions per company, memory condition only. This is a
screening depth, not an audit depth, and small samples per company are why the
aggregate is the headline and the per-company figures are indicative.

---

## Three bugs we found and fixed before publishing

Every one of these produced plausible-looking numbers. We are listing them
because a study that reports only its final run is not showing its work.

**1. Questions that did not name the company.** The synthesis prompt said "do not
name or quote the facts"; the model generalised that to the company, producing
*"How far back can I recover previous versions on the free plan?"* with no
subject. The panel reasonably answered "which service do you mean?", and the
adjudicator scored that as a fabrication — across all 11 domains. The first run
was measuring prompt ambiguity, not model accuracy. Questions are now checked for
the company name and repaired if it is missing.

**2. One page counted three times.** Dropbox was crawled at `/business/pricing`,
`/de/business/pricing` and `/es_ES/business/pricing` — the same page in three
languages, identical length — and later at `/plans` and `/plans?trigger=nr`.
The whole crawl budget went to one page, and four of its "24 facts" were literal
duplicates. Dropbox's figure was **89% wrong** before this was fixed and **71%**
after. Localised paths and attribution parameters are now collapsed, and facts
are deduplicated across pages.

**3. Refusals scored as errors.** *"I cannot provide specific numbers"* was being
extracted as a claim and ruled DRIFTED. A refusal is not a wrong answer — it is
the model not knowing the company, which is a different finding with a different
fix. Scoring it as drift pushed unknown companies below the line reserved for
companies that are actively misdescribed. Hedges are now detected and resolved to
a single UNSUPPORTED finding.

A fourth issue is a known limitation rather than a fixed bug: claims are verified
to be the model's own words, because the extractor was occasionally caught
rewriting a claim into the correct answer before judging it.

---

## What we are not claiming

- **Not that frontier models perform this way.** A different model class would
  produce different numbers, in both directions. See the panel note above.
- **Not an audit of any company.** Three pages and four questions is a screen.
  A company's figure here is indicative, not a verdict on their documentation.
- **Not that the adjudicator is right every time.** It is a language model
  judging language models. Every finding shows the exact span it was decided
  against so a reader can check it, and we are publishing a hand-labelled
  accuracy figure for the adjudicator itself.

Findings describe what a named model answered at a stated time, checked against
what a page said on a stated date. They are never characterisations of a company.
