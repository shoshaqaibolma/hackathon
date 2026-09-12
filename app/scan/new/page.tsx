import Link from "next/link";
import { redirect } from "next/navigation";

import { ScanForm } from "@/components/scan-form";
import { normaliseDomain } from "@/lib/domain";
import { hasReport, listReportDomains } from "@/lib/reports/candidates";
import stats from "@/reports/study-stats.json";

export const metadata = { title: "Start an audit" };

/**
 * Where the landing-page form lands.
 *
 * If we have already audited the submitted domain, go straight to the result.
 * A visitor who types a domain we have measured should get a working product,
 * not a signup form. Everything else gets an honest account of what FREE mode
 * can do today, and somewhere useful to go meanwhile.
 */
export default async function NewScanPage({
  searchParams,
}: {
  searchParams: Promise<{ domain?: string }>;
}) {
  const { domain: raw } = await searchParams;
  const domain = raw ? normaliseDomain(raw) : null;

  if (domain && hasReport(domain)) {
    redirect(`/report/${domain}`);
  }

  const audited = listReportDomains();

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-6 py-20">
      <Link
        href="/"
        className="text-muted-foreground hover:text-foreground text-sm transition-colors"
      >
        ← Parity
      </Link>

      {domain ? (
        <>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight text-balance">
            We haven&rsquo;t audited{" "}
            <span className="font-mono">{domain}</span> yet.
          </h1>
          <p className="text-muted-foreground mt-4 text-pretty">
            Live scans are not open to the public yet. Parity runs on free-tier
            model quotas, and a single audit uses enough of them that opening it to
            everyone would exhaust the day&rsquo;s budget in minutes — so rather
            than queue you behind a spinner that may never resolve, here is what
            exists today.
          </p>
        </>
      ) : (
        <>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight">
            Enter a domain
          </h1>
          <p className="text-muted-foreground mt-3">
            Or pick one of the {audited.length} we have already audited.
          </p>
          <div className="mt-6">
            <ScanForm />
          </div>
        </>
      )}

      <section className="border-border mt-10 rounded-xl border p-6">
        <h2 className="font-medium">{audited.length} sites already audited</h2>
        <p className="text-muted-foreground mt-1.5 text-sm text-pretty">
          Real scans with full evidence. Across all of them,{" "}
          {stats.wrongPercent}% of checkable claims were wrong.
        </p>
        <ul className="mt-5 flex flex-wrap gap-2">
          {audited.map((d) => (
            <li key={d}>
              <Link
                href={`/report/${d}`}
                className="border-border hover:border-foreground/40 inline-block rounded-md border px-3 py-1.5 font-mono text-xs transition-colors"
              >
                {d}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-8 flex flex-wrap gap-3 text-sm">
        <Link
          href="/study"
          className="bg-foreground text-background rounded-md px-4 py-2.5 font-medium transition-opacity hover:opacity-90"
        >
          Read the study
        </Link>
        <Link
          href="/demo"
          className="border-border rounded-md border px-4 py-2.5 font-medium transition-colors hover:border-foreground/40"
        >
          See a full scan
        </Link>
      </div>
    </main>
  );
}
