import Link from "next/link";

import { healthConfigSummary, runHealthChecks, type CheckStatus } from "@/lib/health";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const metadata = {
  title: "Health · Parity",
  description: "Live status of Parity's database, models, and web-search access.",
};

const STATUS_STYLES: Record<CheckStatus, string> = {
  pass: "bg-emerald-500/10 text-emerald-600 ring-emerald-500/20 dark:text-emerald-400",
  fail: "bg-red-500/10 text-red-600 ring-red-500/20 dark:text-red-400",
  skip: "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400",
};

const STATUS_LABEL: Record<CheckStatus, string> = {
  pass: "PASS",
  fail: "FAIL",
  skip: "SKIP",
};

export default async function HealthPage() {
  const report = await runHealthChecks();
  const config = healthConfigSummary();

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-16">
      <header className="mb-10">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          ← Parity
        </Link>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">System health</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Every dependency Parity needs, checked live on each request. Nothing here is
          cached or stubbed.
        </p>
      </header>

      <div
        className={`mb-8 rounded-lg px-4 py-3 text-sm font-medium ring-1 ring-inset ${
          report.ok
            ? STATUS_STYLES.pass
            : "bg-red-500/10 text-red-600 ring-red-500/20 dark:text-red-400"
        }`}
      >
        {report.ok
          ? "All systems operational."
          : "One or more checks failed — see details below."}
      </div>

      <ul className="divide-border border-border divide-y rounded-lg border">
        {report.checks.map((check) => (
          <li
            key={check.name}
            className="flex items-start justify-between gap-4 px-4 py-4"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{check.name}</p>
              <p className="text-muted-foreground mt-1 text-sm break-words">
                {check.detail}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span
                className={`rounded-full px-2 py-0.5 font-mono text-xs ring-1 ring-inset ${
                  STATUS_STYLES[check.status]
                }`}
              >
                {STATUS_LABEL[check.status]}
              </span>
              {check.durationMs !== undefined && (
                <span className="text-muted-foreground font-mono text-xs">
                  {check.durationMs}ms
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>

      <section className="mt-10">
        <h2 className="text-muted-foreground mb-3 text-xs font-medium tracking-wider uppercase">
          Active configuration
        </h2>
        <dl className="border-border grid grid-cols-1 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2">
          <ConfigRow label="Public panel" value={config.panel.join(", ")} />
          <ConfigRow label="Adjudicator" value={config.adjudicator} />
          <ConfigRow label="Free mode" value={config.freeCaps} />
          <ConfigRow label="BYOK mode" value={config.byokCaps} />
          <ConfigRow
            label="BYOK providers"
            value={config.byokProviders.join(", ")}
          />
          <ConfigRow
            label="Concurrency · search results"
            value={`${config.concurrency} · ${config.searchResults}`}
          />
        </dl>
      </section>

      <p className="text-muted-foreground mt-8 font-mono text-xs">
        Checked at {report.checkedAt} · JSON at{" "}
        <Link href="/api/health" className="underline underline-offset-2">
          /api/health
        </Link>
      </p>
    </main>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background px-4 py-3">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm break-words">{value}</dd>
    </div>
  );
}
