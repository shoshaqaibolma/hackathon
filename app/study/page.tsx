import { readFileSync } from "node:fs";
import { join } from "node:path";

import Link from "next/link";

import stats from "@/reports/study-stats.json";

/**
 * The study, served as a page.
 *
 * Reads reports/study.md — the same file the repository publishes — so the
 * page and the committed report can never disagree. Rendered with a small
 * purpose-built formatter rather than a markdown dependency; the document's
 * shape is known and fixed.
 */

export const metadata = {
  title: "What AI assistants get wrong about developer tools",
  description:
    "A measured study of 11 developer-tool websites: 42% of checkable claims were wrong.",
};

function renderMarkdown(md: string) {
  const blocks: React.ReactNode[] = [];
  const lines = md.split("\n");
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("| ")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        const cells = lines[i].split("|").slice(1, -1).map((c) => c.trim());
        if (!cells.every((c) => /^-+$/.test(c) || c === "")) rows.push(cells);
        i += 1;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={key++} className="border-border my-6 overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground border-border bg-muted/40 border-b text-left text-xs">
              <tr>
                {head.map((cell, n) => (
                  <th key={n} className="px-4 py-3 font-medium">{cell}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {body.map((row, n) => (
                <tr key={n}>
                  {row.map((cell, m) => (
                    <td key={m} className={`px-4 py-2.5 ${m === 0 ? "font-mono text-xs" : "tabular-nums"}`}>
                      {inline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (line.startsWith("# ")) {
      blocks.push(
        <h1 key={key++} className="mt-2 mb-6 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {line.slice(2)}
        </h1>,
      );
    } else if (line.startsWith("## ")) {
      blocks.push(
        <h2 key={key++} className="mt-12 mb-3 text-xl font-semibold tracking-tight">
          {line.slice(3)}
        </h2>,
      );
    } else if (line.startsWith("---")) {
      blocks.push(<hr key={key++} className="border-border my-10" />);
    } else if (/^\d+\.\s/.test(line) || line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && (/^\d+\.\s/.test(lines[i]) || lines[i].startsWith("- ") || lines[i].startsWith("   "))) {
        if (lines[i].trim()) {
          if (/^\d+\.\s/.test(lines[i]) || lines[i].startsWith("- ")) {
            items.push(lines[i].replace(/^(\d+\.|-)\s/, ""));
          } else {
            items[items.length - 1] += ` ${lines[i].trim()}`;
          }
        }
        i += 1;
      }
      blocks.push(
        <ul key={key++} className="my-4 space-y-2.5">
          {items.map((item, n) => (
            <li key={n} className="flex gap-2.5 text-pretty">
              <span className="text-muted-foreground mt-0.5 shrink-0">→</span>
              <span>{inline(item)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    } else if (line.trim()) {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() && !lines[i].startsWith("#") && !lines[i].startsWith("|") && !lines[i].startsWith("-")) {
        para.push(lines[i]);
        i += 1;
      }
      blocks.push(
        <p key={key++} className="my-4 text-pretty">{inline(para.join(" "))}</p>,
      );
      continue;
    }

    i += 1;
  }

  return blocks;
}

/** Bold, italic and code spans. Deliberately minimal. */
function inline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g);
  return parts.map((part, n) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={n} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={n} className="bg-muted rounded px-1.5 py-0.5 font-mono text-[0.85em]">{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={n}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

export default function StudyPage() {
  const md = readFileSync(join(process.cwd(), "reports", "study.md"), "utf8");

  return (
    <main className="min-h-screen">
      <nav className="border-border/60 border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="font-mono text-sm font-medium tracking-tight">
            parity
          </Link>
          <div className="text-muted-foreground flex items-center gap-5 text-sm">
            <Link href="/demo" className="hover:text-foreground transition-colors">Demo</Link>
            <Link href="/pricing" className="hover:text-foreground transition-colors">Pricing</Link>
          </div>
        </div>
      </nav>

      <article className="mx-auto w-full max-w-2xl px-6 py-16">
        {renderMarkdown(md)}

        <div className="border-border mt-14 rounded-xl border p-6">
          <p className="font-medium">Run this on your own site.</p>
          <p className="text-muted-foreground mt-2 text-sm text-pretty">
            {stats.wrongPercent}% of claims wrong across {stats.companies} companies.
            Finding out where yours sits takes about a minute.
          </p>
          <Link
            href="/"
            className="bg-foreground text-background mt-5 inline-block rounded-md px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
          >
            Audit my site
          </Link>
        </div>
      </article>
    </main>
  );
}
