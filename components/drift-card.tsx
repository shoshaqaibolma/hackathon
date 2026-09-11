import type { DriftCard as DriftCardData } from "@/lib/view/types";

/**
 * THE object. This is what a judge sees in a screenshot, so its anatomy is
 * fixed (CLAUDE.md): question on top, verdict chip, two panes side by side —
 * ground truth from your page on the left, the model's literal claim on the
 * right — and the generated patch underneath.
 *
 * Both panes are verbatim. Never paraphrase either side; the credibility of
 * the whole product rests on that.
 *
 * Design pass lands in Phase 5. The structure is already load-bearing.
 */

const RULING_STYLE: Record<DriftCardData["ruling"], string> = {
  CONFIRMED:
    "bg-emerald-500/10 text-emerald-700 ring-emerald-500/30 dark:text-emerald-400",
  DRIFTED: "bg-amber-500/10 text-amber-700 ring-amber-500/30 dark:text-amber-400",
  UNSUPPORTED: "bg-slate-500/10 text-slate-700 ring-slate-500/30 dark:text-slate-300",
  FABRICATED: "bg-red-500/10 text-red-700 ring-red-500/30 dark:text-red-400",
};

const KIND_LABEL: Record<string, string> = {
  LLMS_TXT: "llms.txt",
  JSON_LD: "JSON-LD",
  PAGE_COPY: "page copy",
};

export function DriftCard({ card }: { card: DriftCardData }) {
  return (
    <article className="border-border bg-background overflow-hidden rounded-xl border">
      <header className="border-border flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-medium text-pretty">{card.question}</h3>
          <p className="text-muted-foreground mt-1.5 font-mono text-xs">
            {card.modelLabel} · {card.condition}
            {card.latencyMs !== null && ` · ${(card.latencyMs / 1000).toFixed(1)}s`}
            {" · weight "}
            {card.weight}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span
            className={`rounded-full px-2.5 py-1 font-mono text-xs font-medium ring-1 ring-inset ${RULING_STYLE[card.ruling]}`}
          >
            {card.ruling}
          </span>
          {card.downgraded && (
            <span className="text-muted-foreground text-[10px]">
              downgraded · invalid citation
            </span>
          )}
        </div>
      </header>

      <div className="divide-border grid grid-cols-1 divide-y md:grid-cols-2 md:divide-x md:divide-y-0">
        <section className="px-5 py-4">
          <h4 className="text-muted-foreground mb-2 text-[11px] font-medium tracking-wider uppercase">
            Ground truth · your page
          </h4>
          {card.groundTruth ? (
            <>
              <blockquote className="border-emerald-500/40 text-foreground border-l-2 pl-3 text-sm">
                “{card.evidenceQuote ?? card.groundTruth.evidenceSpan}”
              </blockquote>
              <a
                href={card.groundTruth.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground hover:text-foreground mt-2.5 inline-block font-mono text-xs break-all underline-offset-2 hover:underline"
              >
                {card.groundTruth.sourceUrl} ↗
              </a>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              Nothing in your ledger addresses this. The model had no source to be
              right or wrong against.
            </p>
          )}
        </section>

        <section className="px-5 py-4">
          <h4 className="text-muted-foreground mb-2 text-[11px] font-medium tracking-wider uppercase">
            Model claim
          </h4>
          <blockquote className="border-border text-foreground border-l-2 pl-3 text-sm">
            “{card.claimText}”
          </blockquote>
          <p className="text-muted-foreground mt-2.5 font-mono text-xs">
            confidence {card.confidence.toFixed(2)}
          </p>
        </section>
      </div>

      {card.reasoning && (
        <div className="border-border text-muted-foreground border-t px-5 py-3 text-sm">
          {card.reasoning}
        </div>
      )}

      {card.condition === "BROWSING" && card.retrieval.length > 0 && (
        <details className="border-border border-t px-5 py-3">
          <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs">
            {card.retrieval.length} source
            {card.retrieval.length === 1 ? "" : "s"} retrieved and shown to the model
            {card.searchQuery && (
              <span className="font-mono"> · “{card.searchQuery}”</span>
            )}
          </summary>
          <ul className="mt-3 space-y-2.5">
            {card.retrieval.map((snippet, i) => (
              <li key={`${snippet.url}-${i}`} className="text-xs">
                <a
                  href={snippet.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {snippet.title}
                </a>
                <p className="text-muted-foreground mt-0.5 line-clamp-3">
                  {snippet.snippet}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}

      {card.remediation && (
        <div className="border-border bg-muted/40 border-t px-5 py-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h4 className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
              Suggested fix ·{" "}
              {KIND_LABEL[card.remediation.kind] ?? card.remediation.kind}
            </h4>
            {card.remediation.targetUrl && (
              <span className="text-muted-foreground truncate font-mono text-[11px]">
                {card.remediation.targetUrl}
              </span>
            )}
          </div>
          <pre className="border-border bg-background overflow-x-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">
            {card.remediation.content}
          </pre>
          {card.remediation.rationale && (
            <p className="text-muted-foreground mt-2 text-xs">
              {card.remediation.rationale}
            </p>
          )}
        </div>
      )}
    </article>
  );
}
