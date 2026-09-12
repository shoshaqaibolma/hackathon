import Link from "next/link";

import { ScanForm } from "@/components/scan-form";
import stats from "@/reports/study-stats.json";

/**
 * Landing page.
 *
 * The problem in one line, then immediate proof, then the input. The proof is
 * imported from reports/study-stats.json rather than typed here — a marketing
 * page quoting a stale number is precisely the failure this product exists to
 * catch, and hard-coding it would be embarrassing on a slide.
 */

export const metadata = {
  title: "Parity — is what AI says about you true?",
  description:
    "Every AEO tool measures whether AI assistants mention you. Parity measures whether what they say is true — and emits the fix.",
};

export default function Home() {
  return (
    <main className="min-h-screen">
      <nav className="border-border/60 border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
          <span className="font-mono text-sm font-medium tracking-tight">parity</span>
          <div className="text-muted-foreground flex items-center gap-5 text-sm">
            <Link href="/demo" className="hover:text-foreground transition-colors">
              Demo
            </Link>
            <Link href="/study" className="hover:text-foreground transition-colors">
              Study
            </Link>
            <Link href="/pricing" className="hover:text-foreground transition-colors">
              Pricing
            </Link>
          </div>
        </div>
      </nav>

      {/* ---------------------------------------------------------- hero */}
      <section className="mx-auto w-full max-w-3xl px-6 pt-20 pb-16">
        <p className="text-muted-foreground mb-5 font-mono text-xs tracking-wider uppercase">
          AI answer-correctness auditing
        </p>

        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Every other tool checks whether AI mentions you.
          <br />
          <span className="text-muted-foreground">
            We check whether it&rsquo;s telling the truth.
          </span>
        </h1>

        <p className="text-muted-foreground mt-6 max-w-xl text-lg text-pretty">
          Parity reads your site, asks the questions your customers ask, and checks
          every claim the models make against your own words — then writes the patch
          that fixes what they got wrong.
        </p>

        <div className="mt-10">
          <ScanForm />
        </div>
      </section>

      {/* --------------------------------------------------------- proof */}
      <section className="border-border/60 border-y bg-muted/30">
        <div className="mx-auto w-full max-w-5xl px-6 py-14">
          <div className="grid gap-10 sm:grid-cols-3">
            {/* Fractions lead. A bare "100%" on a five-claim sample reads as a
                claim; "5 of 5" reads as the small measurement it is. */}
            <div>
              <p className="text-4xl font-semibold tabular-nums">
                {stats.wrong} of {stats.checkable}
              </p>
              <p className="text-muted-foreground mt-2 text-sm text-pretty">
                checkable claims about {stats.companies} developer tools were wrong
                — {stats.wrongPercent}% of everything their own sites could settle.
              </p>
            </div>
            <div>
              <p className="text-4xl font-semibold tabular-nums">
                {stats.worst.wrong} of {stats.worst.checkable}
              </p>
              <p className="text-muted-foreground mt-2 text-sm text-pretty">
                wrong for the worst-affected company, on prices published plainly
                on its own pricing page.
              </p>
            </div>
            <div>
              <p className="text-4xl font-semibold tabular-nums">
                {stats.unsupported}
              </p>
              <p className="text-muted-foreground mt-2 text-sm text-pretty">
                further claims we could not check at all, because the company&rsquo;s
                site never addresses them. Being unanswerable is its own problem.
              </p>
            </div>
          </div>

          <p className="text-muted-foreground mt-8 text-sm text-pretty">
            From our own study, run {stats.scannedAt}, asking each model from memory
            with no web search.{" "}
            <Link href="/study" className="text-foreground underline underline-offset-4">
              Read it
            </Link>{" "}
            — every number is reproducible from the repository.
          </p>
        </div>
      </section>

      {/* ----------------------------------------------------- mechanism */}
      <section className="mx-auto w-full max-w-3xl px-6 py-20">
        <h2 className="text-2xl font-semibold tracking-tight">
          Two conditions, one diagnosis
        </h2>
        <p className="text-muted-foreground mt-3 text-pretty">
          We ask every question twice: once from the model&rsquo;s memory, once with
          live search. The gap between them tells you which problem you actually
          have — and nobody else reports it.
        </p>

        <div className="border-border mt-8 overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground border-border bg-muted/40 border-b text-left text-xs">
              <tr>
                <th className="px-4 py-3 font-medium">From memory</th>
                <th className="px-4 py-3 font-medium">With search</th>
                <th className="px-4 py-3 font-medium">What it means</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {[
                ["wrong", "right", "Training data is stale. Your site is fine."],
                ["wrong", "wrong", "Your site is wrong, or silent on the subject."],
                ["right", "wrong", "Something outranking you is contradicting you."],
                ["right", "right", "You have parity."],
              ].map(([memory, browsing, meaning]) => (
                <tr key={meaning}>
                  <td className="px-4 py-3 font-mono text-xs">{memory}</td>
                  <td className="px-4 py-3 font-mono text-xs">{browsing}</td>
                  <td className="px-4 py-3">{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-16">
          <h2 className="text-2xl font-semibold tracking-tight">
            Every finding shows its evidence
          </h2>
          <p className="text-muted-foreground mt-3 text-pretty">
            Your page&rsquo;s exact words on the left, the model&rsquo;s exact words
            on the right, the patch underneath. Nothing is paraphrased, and a fact
            whose quote we cannot locate verbatim on your page is discarded rather
            than reported.
          </p>
          <Link
            href="/demo"
            className="bg-foreground text-background mt-7 inline-block rounded-md px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
          >
            See a real scan
          </Link>
        </div>
      </section>

      <footer className="border-border/60 border-t">
        <div className="text-muted-foreground mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-xs">
          <span>
            Findings describe what a named model said at a stated time, checked
            against a page as captured on that date.
          </span>
          <Link href="/health" className="hover:text-foreground font-mono">
            status
          </Link>
        </div>
      </footer>
    </main>
  );
}
