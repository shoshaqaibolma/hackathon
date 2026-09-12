import type { Diagnosis, TwoConditionCard as Pair } from "@/lib/view/pairing";
import type { DriftCard } from "@/lib/view/types";

/**
 * THE hero object.
 *
 * The same question, asked twice — once from the model's memory, once with
 * live retrieval — with your page's own words underneath as the arbiter.
 * The contrast between the two panes is the entire thesis, and it is the one
 * thing nothing else in this category shows.
 *
 * Both panes are verbatim. The credibility of the product rests on a reader
 * being able to check every word against the source.
 */

const DIAGNOSIS_STYLE: Record<
  Diagnosis,
  { chip: string; rail: string; label: string }
> = {
  SITE_WRONG_OR_SILENT: {
    chip: "bg-red-500/10 text-red-700 ring-red-500/30 dark:text-red-400",
    rail: "bg-red-500",
    label: "Your site",
  },
  STALE_TRAINING: {
    chip: "bg-amber-500/10 text-amber-700 ring-amber-500/30 dark:text-amber-400",
    rail: "bg-amber-500",
    label: "Stale memory",
  },
  OUTRANKED: {
    chip: "bg-violet-500/10 text-violet-700 ring-violet-500/30 dark:text-violet-400",
    rail: "bg-violet-500",
    label: "Outranked",
  },
  PARITY: {
    chip: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/30 dark:text-emerald-400",
    rail: "bg-emerald-500",
    label: "Parity",
  },
  PARTIAL: {
    chip: "bg-slate-500/10 text-slate-700 ring-slate-500/30 dark:text-slate-300",
    rail: "bg-slate-400",
    label: "Incomparable",
  },
};

const RULING_TONE: Record<DriftCard["ruling"], string> = {
  CONFIRMED: "text-emerald-700 dark:text-emerald-400",
  DRIFTED: "text-amber-700 dark:text-amber-400",
  FABRICATED: "text-red-700 dark:text-red-400",
  UNSUPPORTED: "text-muted-foreground",
};

function ConditionPane({
  label,
  sublabel,
  card,
}: {
  label: string;
  sublabel: string;
  card: DriftCard | null;
}) {
  return (
    <section className="flex flex-col px-5 py-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h4 className="text-[11px] font-medium tracking-wider uppercase">{label}</h4>
        <span className="text-muted-foreground font-mono text-[10px]">{sublabel}</span>
      </div>

      {card ? (
        <>
          <blockquote className="text-foreground flex-1 text-sm text-pretty">
            &ldquo;{card.claimText}&rdquo;
          </blockquote>
          <p
            className={`mt-3 font-mono text-xs font-medium ${RULING_TONE[card.ruling]}`}
          >
            {card.ruling}
          </p>
          {card.condition === "BROWSING" && (
            <p className="text-muted-foreground mt-1 font-mono text-[10px]">
              {card.retrieval.length > 0
                ? `read ${card.retrieval.length} source${card.retrieval.length === 1 ? "" : "s"}`
                : "retrieved nothing"}
            </p>
          )}
        </>
      ) : (
        <p className="text-muted-foreground flex-1 text-sm">
          Not run for this question.
        </p>
      )}
    </section>
  );
}

export function TwoConditionCard({ pair }: { pair: Pair }) {
  const style = DIAGNOSIS_STYLE[pair.diagnosis];
  const truth = pair.memory?.groundTruth ?? pair.browsing?.groundTruth ?? null;
  const capturedAt =
    pair.memory?.sourceCapturedAt ?? pair.browsing?.sourceCapturedAt ?? null;
  const patch = pair.memory?.remediation ?? pair.browsing?.remediation ?? null;

  return (
    <article className="border-border bg-background relative overflow-hidden rounded-xl border">
      {/* Colour rail: the diagnosis readable before a word is read. */}
      <div className={`absolute inset-y-0 left-0 w-1 ${style.rail}`} aria-hidden />

      <header className="border-border border-b py-4 pr-5 pl-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h3 className="flex-1 text-base font-medium text-pretty">{pair.question}</h3>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 font-mono text-[11px] font-medium ring-1 ring-inset ${style.chip}`}
          >
            {style.label}
          </span>
        </div>
        <p className="mt-2 text-sm font-medium text-pretty">{pair.headline}</p>
        <p className="text-muted-foreground mt-1.5 font-mono text-[11px]">
          {pair.modelLabel} · {pair.questionCategory.toLowerCase()}
        </p>
      </header>

      {/* The comparison. Same question, two conditions, side by side. */}
      <div className="divide-border bg-muted/20 grid grid-cols-1 divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <ConditionPane
          label="From memory"
          sublabel="no search"
          card={pair.memory}
        />
        <ConditionPane
          label="With search"
          sublabel="live retrieval"
          card={pair.browsing}
        />
      </div>

      {/* The arbiter: your own words. */}
      <div className="border-border border-t py-4 pr-5 pl-6">
        <h4 className="text-muted-foreground mb-2 text-[11px] font-medium tracking-wider uppercase">
          Your page says
        </h4>
        {truth ? (
          <>
            <blockquote className="border-l-2 border-emerald-500/50 pl-3 text-sm text-pretty">
              &ldquo;{truth.evidenceSpan}&rdquo;
            </blockquote>
            <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px]">
              <a
                href={truth.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="hover:text-foreground break-all underline-offset-2 hover:underline"
              >
                {truth.sourceUrl}
              </a>
              {capturedAt && <span>captured {capturedAt.slice(0, 10)}</span>}
            </div>
          </>
        ) : (
          <p className="text-muted-foreground text-sm text-pretty">
            Nothing on your site addresses this. The models had no source to be
            right or wrong against — which is itself the finding.
          </p>
        )}
      </div>

      <div className="border-border text-muted-foreground border-t py-3 pr-5 pl-6 text-sm text-pretty">
        {pair.advice}
      </div>

      {patch && (
        <div className="border-border bg-muted/40 border-t py-4 pr-5 pl-6">
          <h4 className="text-muted-foreground mb-2 text-[11px] font-medium tracking-wider uppercase">
            Suggested fix · {patch.kind.replace("_", " ").toLowerCase()}
          </h4>
          <pre className="border-border bg-background overflow-x-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">
            {patch.content}
          </pre>
        </div>
      )}
    </article>
  );
}
