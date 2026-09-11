import Link from "next/link";

/**
 * Placeholder. The real landing page is Phase 5 — see PLAN.md §9.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-6 py-16">
      <p className="text-muted-foreground font-mono text-xs tracking-wider uppercase">
        Parity
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance">
        Every other tool measures whether AI assistants mention you. Parity measures
        whether what they say is true.
      </h1>
      <p className="text-muted-foreground mt-4 text-base">
        Crawl a site into a ledger of cited facts, interrogate the models that answer
        questions about it, and emit the patch that fixes what they get wrong.
      </p>

      <div className="mt-8 flex items-center gap-4 text-sm">
        <Link
          href="/health"
          className="bg-foreground text-background rounded-md px-4 py-2 font-medium transition-opacity hover:opacity-90"
        >
          System health
        </Link>
        <span className="text-muted-foreground font-mono text-xs">
          Phase 1 · skeleton
        </span>
      </div>
    </main>
  );
}
