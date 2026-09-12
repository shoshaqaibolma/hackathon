import Link from "next/link";

import { getFixtureIndex } from "@/lib/demo/fixtures";

export const metadata = {
  title: "Demo scans",
  description:
    "Precomputed Parity scans. No API key, no network calls, no rate limits.",
};

export default function DemoIndexPage() {
  const { fixtures, issues } = getFixtureIndex();

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-16">
      <header className="mb-10">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          ← Parity
        </Link>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Demo scans</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm">
          Real scans, recorded and frozen. These pages read from disk — no database,
          no API key, no network call, no quota. Nothing here can fail because
          something else is down.
        </p>
      </header>

      {issues.length > 0 && (
        <div className="mb-6 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-600 ring-1 ring-red-500/20 ring-inset dark:text-red-400">
          <p className="font-medium">
            {issues.length} fixture file{issues.length === 1 ? "" : "s"} could not be
            loaded
          </p>
          <ul className="mt-1.5 space-y-0.5 font-mono text-xs">
            {issues.map((issue) => (
              <li key={issue.file}>
                {issue.file} — {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {fixtures.length === 0 ? (
        <div className="border-border rounded-lg border border-dashed px-6 py-10 text-center">
          <p className="text-sm font-medium">No scans recorded yet.</p>
          <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm">
            Fixtures are recorded from real scans, not hand-written. Once the
            pipeline produces one, <code className="font-mono">pnpm demo:record</code>{" "}
            freezes it here.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {fixtures.map((fixture) => (
            <li key={fixture.slug}>
              <Link
                href={`/demo/${fixture.slug}`}
                className="border-border hover:border-foreground/30 block h-full rounded-xl border p-5 transition-colors"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-sm">{fixture.domain}</span>
                  <span className="text-2xl font-semibold tabular-nums">
                    {fixture.claimsCheckable === 0
                      ? "—"
                      : `${Math.round((fixture.claimsWrong / fixture.claimsCheckable) * 100)}%`}
                  </span>
                </div>
                <p className="text-muted-foreground mt-2 text-sm text-pretty">
                  {fixture.headline}
                </p>
                <p className="text-muted-foreground mt-3 font-mono text-xs">
                  {fixture.claimsWrong}/{fixture.claimsCheckable} claims wrong ·{" "}
                  {fixture.facts.length} facts · Parity{" "}
                  {fixture.parityScore === null ? "—" : Math.round(fixture.parityScore)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
