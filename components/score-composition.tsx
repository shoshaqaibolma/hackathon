import type { z } from "zod";

import type { CompositionSchema } from "@/lib/view/types";

type Composition = z.infer<typeof CompositionSchema>;

/**
 * The stacked bar that always sits beside the Parity Score.
 *
 * A mid-range score is ambiguous alone: 52 from "mostly confirmed, two
 * fabrications" and 52 from "nothing but drift" are different products.
 * Segments are weight-shares, not counts, so the bar and the number are
 * built from the same arithmetic.
 */

const SEGMENTS = [
  { key: "CONFIRMED", label: "Confirmed", bar: "bg-emerald-500", dot: "bg-emerald-500" },
  { key: "DRIFTED", label: "Drifted", bar: "bg-amber-500", dot: "bg-amber-500" },
  { key: "UNSUPPORTED", label: "Unsupported", bar: "bg-slate-400", dot: "bg-slate-400" },
  { key: "FABRICATED", label: "Fabricated", bar: "bg-red-500", dot: "bg-red-500" },
] as const;

export function ScoreComposition({
  composition,
  className = "",
}: {
  composition: Composition;
  className?: string;
}) {
  if (composition.total === 0) {
    return (
      <p className={`text-muted-foreground text-sm ${className}`}>
        No verdicts — nothing to compose.
      </p>
    );
  }

  return (
    <div className={className}>
      <div
        className="bg-muted flex h-2.5 w-full overflow-hidden rounded-full"
        role="img"
        aria-label={SEGMENTS.map(
          (s) => `${s.label}: ${composition.counts[s.key] ?? 0}`,
        ).join(", ")}
      >
        {SEGMENTS.map((segment) => {
          const share = composition.weightShare[segment.key] ?? 0;
          if (share <= 0) return null;
          return (
            <div
              key={segment.key}
              className={segment.bar}
              style={{ width: `${share * 100}%` }}
            />
          );
        })}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {SEGMENTS.map((segment) => {
          const count = composition.counts[segment.key] ?? 0;
          if (count === 0) return null;
          return (
            <li
              key={segment.key}
              className="text-muted-foreground flex items-center gap-1.5 text-xs"
            >
              <span className={`size-2 rounded-full ${segment.dot}`} />
              <span className="text-foreground font-medium">{count}</span>
              {segment.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
