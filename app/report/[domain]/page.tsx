import Link from "next/link";
import { notFound } from "next/navigation";

import { DriftCard } from "@/components/drift-card";
import { ScoreComposition } from "@/components/score-composition";
import { TwoConditionCard } from "@/components/two-condition-card";
import { getFixtureForDomain } from "@/lib/demo/fixtures";
import { getReportView, listReportDomains } from "@/lib/reports/candidates";
import { heroCards, pairByCondition } from "@/lib/view/pairing";
import { PUBLICATION_NOTICE } from "@/lib/view/types";

export function generateStaticParams() {
  return listReportDomains().map((domain) => ({ domain }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ domain: string }>;
}) {
  const { domain } = await params;
  const view = getReportView(domain);
  if (!view) return { title: "Audit" };
  return {
    title: `${view.domain} — what AI gets wrong`,
    description: view.wrongHeadline,
  };
}

export default async function ReportPage({
  params,
}: {
  params: Promise<{ domain: string }>;
}) {
  const { domain } = await params;
  const view = getReportView(domain);
  if (!view) notFound();

  const cards = view.runs.at(-1)?.driftCards ?? [];
  const pairs = pairByCondition(cards);
  const heroes = heroCards(pairs);
  const heroIds = new Set(
    heroes.flatMap((h) => [h.memory?.id, h.browsing?.id].filter(Boolean)),
  );
  const rest = cards.filter((card) => !heroIds.has(card.id));

  const wrongPercent =
    view.claimsCheckable > 0
      ? Math.round((view.claimsWrong / view.claimsCheckable) * 100)
      : null;

  // A deeper scan of the same company, if we have one.
  const fuller = getFixtureForDomain(view.domain);

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-14">
      <Link
        href="/"
        className="text-muted-foreground hover:text-foreground text-sm transition-colors"
      >
        ← Parity
      </Link>

      <header className="mt-5 flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="font-mono text-2xl font-semibold tracking-tight">
            {view.domain}
          </h1>
          <p className="mt-2 max-w-lg text-base font-medium text-pretty">
            {view.wrongHeadline}
          </p>
        </div>
        <div className="text-right">
          {/* The fraction leads: on a small sample a bare percentage
              overstates how much was measured. */}
          <p className="text-5xl font-semibold tabular-nums">
            {view.claimsCheckable === 0
              ? "—"
              : `${view.claimsWrong} of ${view.claimsCheckable}`}
          </p>
          <p className="text-muted-foreground text-xs">
            checkable claims wrong
            {wrongPercent !== null && ` · ${wrongPercent}%`}
          </p>
          <p className="text-muted-foreground mt-1.5 font-mono text-xs">
            Parity Score{" "}
            {view.parityScore === null ? "—" : Math.round(view.parityScore)}
          </p>
        </div>
      </header>

      {/* Depth and date up front, so two runs of the same company read as two
          measurements rather than as a contradiction. */}
      <div className="border-border text-muted-foreground mt-8 rounded-lg border border-dashed px-4 py-3 text-sm text-pretty">
        <span className="text-foreground font-medium">
          Screening run · {view.createdAt.slice(0, 10)} · memory condition only.
        </span>{" "}
        Read {view.pages.length} pages, asked {view.questions.length} questions, and
        put them to {view.panel[0]?.label ?? "one model"} with no web search. Small
        samples move a percentage a long way, which is why the count is shown
        alongside it.
        {fuller && (
          <>
            {" "}
            <Link
              href={`/demo/${fuller.slug}`}
              className="text-foreground font-medium underline underline-offset-4"
            >
              A deeper scan of {view.domain} exists
            </Link>{" "}
            — {fuller.questions.length} questions across both conditions, recorded{" "}
            {fuller.recordedAt.slice(0, 10)}. It is the better measurement, and its
            numbers differ because it asked more.
          </>
        )}
      </div>

      <section className="border-border mt-8 rounded-xl border p-5">
        <ScoreComposition composition={view.composition} />
      </section>

      {heroes.length > 0 && (
        <section className="mt-12">
          <h2 className="text-lg font-medium">Memory versus search</h2>
          <p className="text-muted-foreground mt-1 mb-5 text-sm text-pretty">
            The same question asked twice. The gap between the two answers is what
            tells you whose problem it is.
          </p>
          <div className="space-y-5">
            {heroes.map((pair) => (
              <TwoConditionCard key={pair.id} pair={pair} />
            ))}
          </div>
        </section>
      )}

      <section className="mt-12">
        <h2 className="text-lg font-medium">
          Findings
          <span className="text-muted-foreground ml-2 text-sm font-normal">
            {rest.length}, most severe first
          </span>
        </h2>
        <div className="mt-5 space-y-4">
          {rest.map((card) => (
            <DriftCard key={card.id} card={card} />
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-medium">
          What we read
          <span className="text-muted-foreground ml-2 text-sm font-normal">
            {view.facts.length} facts from {view.pages.length} pages
          </span>
        </h2>
        <ul className="divide-border border-border mt-5 divide-y rounded-xl border">
          {view.facts.slice(0, 10).map((fact) => (
            <li key={fact.id} className="px-5 py-4">
              <p className="text-sm">{fact.statement}</p>
              <blockquote className="border-border text-muted-foreground mt-2 border-l-2 pl-3 text-xs">
                &ldquo;{fact.evidenceSpan}&rdquo;
              </blockquote>
              <a
                href={fact.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground hover:text-foreground mt-1.5 inline-block font-mono text-[11px] break-all underline-offset-2 hover:underline"
              >
                {fact.sourceUrl}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <footer className="border-border text-muted-foreground mt-12 border-t pt-6 text-xs text-pretty">
        {PUBLICATION_NOTICE}
      </footer>
    </main>
  );
}
