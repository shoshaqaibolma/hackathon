import Link from "next/link";
import { notFound } from "next/navigation";

import { DriftCard } from "@/components/drift-card";
import { ScoreComposition } from "@/components/score-composition";
import { getFixture, listFixtures } from "@/lib/demo/fixtures";

export function generateStaticParams() {
  return listFixtures().map((fixture) => ({ slug: fixture.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const fixture = getFixture(slug);
  if (!fixture) return { title: "Demo scan" };
  return {
    title: `${fixture.domain} — demo scan`,
    description: fixture.headline,
  };
}

export default async function DemoScanPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const fixture = getFixture(slug);
  if (!fixture) notFound();

  const latestRun = fixture.runs.at(-1);
  const baselineRun = fixture.runs.at(0);
  const improved =
    fixture.runs.length > 1 &&
    baselineRun?.parityScore != null &&
    latestRun?.parityScore != null
      ? latestRun.parityScore - baselineRun.parityScore
      : null;

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-16">
      <header className="mb-10">
        <Link
          href="/demo"
          className="text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          ← Demo scans
        </Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="font-mono text-2xl font-semibold tracking-tight">
              {fixture.domain}
            </h1>
            <p className="text-muted-foreground mt-2 max-w-xl text-sm text-pretty">
              {fixture.headline}
            </p>
          </div>
          <div className="text-right">
            {/* Headline is wrong%, not the Parity Score: the score's ceiling
                is set by ledger coverage, so a perfect record can still read
                as a mediocre number. See lib/score.ts. */}
            <p className="text-5xl font-semibold tabular-nums">
              {fixture.claimsCheckable === 0
                ? "—"
                : `${Math.round((fixture.claimsWrong / fixture.claimsCheckable) * 100)}%`}
            </p>
            <p className="text-muted-foreground text-xs">of checkable claims wrong</p>
            <p className="text-muted-foreground mt-2 font-mono text-xs">
              Parity Score{" "}
              {fixture.parityScore === null ? "—" : Math.round(fixture.parityScore)}
            </p>
          </div>
        </div>
      </header>

      {fixture.integrity.length > 0 && (
        <section className="mb-10 rounded-xl bg-red-500/10 p-5 ring-1 ring-red-500/20 ring-inset">
          <h2 className="text-sm font-semibold text-red-700 dark:text-red-400">
            This scan is structurally incomplete — no Parity Score is shown
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">
            A score computed from this data would look exactly like a real one
            and be wrong. The findings below are still shown, but they are not a
            complete picture.
          </p>
          <ul className="mt-3 space-y-1.5">
            {fixture.integrity.map((violation, i) => (
              <li key={i} className="text-xs">
                <span className="font-mono text-red-700 dark:text-red-400">
                  {violation.code}
                </span>{" "}
                <span className="text-muted-foreground">
                  {violation.subject} — {violation.message}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="border-border mb-10 rounded-xl border p-5">
        <p className="text-base font-medium">{fixture.wrongHeadline}</p>
        <p className="text-muted-foreground mt-1 mb-4 text-sm">
          {fixture.interpretation}
        </p>
        <ScoreComposition composition={fixture.composition} />
        {improved !== null && (
          <p className="text-muted-foreground mt-4 border-t border-border pt-4 text-sm">
            After applying the generated patches, the same question set scored{" "}
            <span className="text-foreground font-medium tabular-nums">
              {improved >= 0 ? "+" : ""}
              {improved.toFixed(1)}
            </span>{" "}
            points.
          </p>
        )}
      </section>

      {fixture.warnings.length > 0 && (
        <section className="mb-10 rounded-lg bg-amber-500/10 px-4 py-3 ring-1 ring-amber-500/20 ring-inset">
          <h2 className="text-sm font-medium text-amber-700 dark:text-amber-400">
            {fixture.warnings.length} warning
            {fixture.warnings.length === 1 ? "" : "s"} during this scan
          </h2>
          <ul className="text-muted-foreground mt-1.5 space-y-0.5 text-xs">
            {fixture.warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="mb-10">
        <h2 className="mb-4 text-lg font-medium">
          Findings
          <span className="text-muted-foreground ml-2 text-sm font-normal">
            {latestRun?.driftCards.length ?? 0} verdicts, most severe first
          </span>
        </h2>
        <div className="space-y-4">
          {(latestRun?.driftCards ?? []).map((card) => (
            <DriftCard key={card.id} card={card} />
          ))}
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-4 text-lg font-medium">
          Fact ledger
          <span className="text-muted-foreground ml-2 text-sm font-normal">
            {fixture.facts.length} facts from {fixture.pages.length} pages
          </span>
        </h2>
        <ul className="divide-border border-border divide-y rounded-xl border">
          {fixture.facts.slice(0, 12).map((fact) => (
            <li key={fact.id} className="px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm">{fact.statement}</p>
                <span className="text-muted-foreground bg-muted shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]">
                  {fact.category}
                </span>
              </div>
              <blockquote className="border-border text-muted-foreground mt-2 border-l-2 pl-3 text-xs">
                “{fact.evidenceSpan}”
              </blockquote>
              <a
                href={fact.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground hover:text-foreground mt-1.5 inline-block font-mono text-[11px] break-all underline-offset-2 hover:underline"
              >
                {fact.sourceUrl} ↗
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-medium">What this scan cost</h2>
        <div className="border-border overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground border-border border-b text-left text-xs">
              <tr>
                <th className="px-4 py-2.5 font-medium">Stage</th>
                <th className="px-4 py-2.5 font-medium">Model</th>
                <th className="px-4 py-2.5 text-right font-medium">Calls</th>
                <th className="px-4 py-2.5 text-right font-medium">From cache</th>
                <th className="px-4 py-2.5 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {fixture.cost.lines.map((line, i) => (
                <tr key={`${line.stage}-${line.model}-${i}`}>
                  <td className="px-4 py-2.5 font-mono text-xs">{line.stage}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{line.model}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{line.calls}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {line.cachedCalls > 0 ? (
                      <span className="text-amber-600 dark:text-amber-400">
                        {line.cachedCalls}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                    {line.costUsd === null ? "free tier" : `$${line.costUsd.toFixed(4)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {fixture.cost.cachedCalls > 0 && (
          <p className="text-muted-foreground mt-3 text-xs">
            {fixture.cost.cachedCalls} of {fixture.cost.totalCalls} calls were served
            from cache — that work was already done and was not paid for again.
          </p>
        )}
      </section>

      <p className="text-muted-foreground mt-10 font-mono text-xs">
        Recorded {fixture.recordedAt} · fixture v{fixture.fixtureVersion} · served from
        disk, no database or network
      </p>
    </main>
  );
}
