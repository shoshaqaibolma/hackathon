/**
 * Hand-labelling tool for the adjudicator eval set.
 *
 *   pnpm review init heroku.com notion.so dropbox.com   build eval/labels.json
 *   pnpm review                                          label interactively
 *   pnpm review score                                    accuracy vs your labels
 *
 * Labels live in eval/labels.json and are committed. Edit that file by hand
 * if you prefer — the interactive mode is a convenience, not the format.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { join } from "node:path";

import {
  agreement,
  LabelFileSchema,
  REVIEW_INSTRUCTIONS,
  type Label,
  type LabelFile,
} from "@/lib/eval/labels";

const EVAL_DIR = join(process.cwd(), "eval");
const LABELS_PATH = join(EVAL_DIR, "labels.json");
const CANDIDATES_DIR = join(process.cwd(), "candidates");

const KEYS: Record<string, Label["label"]> = {
  c: "CONFIRMED",
  d: "DRIFTED",
  f: "FABRICATED",
  u: "UNSUPPORTED",
  "?": "UNCLEAR",
};

function load(): LabelFile {
  if (!existsSync(LABELS_PATH)) {
    console.error(`No label file at ${LABELS_PATH}. Run: pnpm review init <domain...>`);
    process.exit(1);
  }
  return LabelFileSchema.parse(JSON.parse(readFileSync(LABELS_PATH, "utf8")));
}

function save(file: LabelFile): void {
  mkdirSync(EVAL_DIR, { recursive: true });
  writeFileSync(LABELS_PATH, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

function init(domains: string[]): void {
  if (domains.length === 0) {
    console.error("Usage: pnpm review init <domain...>");
    process.exit(1);
  }

  // Preserve any labels already applied, keyed by id.
  const existing = new Map<string, Label>();
  if (existsSync(LABELS_PATH)) {
    for (const item of load().items) existing.set(item.id, item);
  }

  const items: Label[] = [];

  for (const domain of domains) {
    const path = join(CANDIDATES_DIR, `${domain}.json`);
    if (!existsSync(path)) {
      console.error(`No scan at ${path} — run pnpm candidate:scan ${domain} first.`);
      process.exit(1);
    }

    const report = JSON.parse(readFileSync(path, "utf8")) as {
      findings: {
        question: string;
        claim: string;
        ruling: string;
        evidenceSpan: string | null;
        sourceUrl: string | null;
        note: string;
      }[];
    };

    report.findings.forEach((finding, index) => {
      const id = `${domain}#${index}`;
      const prior = existing.get(id);
      items.push({
        id,
        domain,
        question: finding.question,
        claim: finding.claim,
        predicted: finding.ruling as Label["predicted"],
        evidenceSpan: finding.evidenceSpan,
        sourceUrl: finding.sourceUrl,
        adjudicatorNote: finding.note,
        // Only carry a prior label forward if the finding is unchanged.
        label:
          prior && prior.claim === finding.claim && prior.predicted === finding.ruling
            ? prior.label
            : null,
        comment: prior?.comment ?? "",
      });
    });
  }

  const carried = items.filter((i) => i.label !== null).length;
  save({
    version: 1,
    createdAt: new Date().toISOString(),
    reviewer: existsSync(LABELS_PATH) ? load().reviewer : "",
    items,
  });

  console.log(
    `Wrote ${items.length} findings from ${domains.length} scan(s) to ${LABELS_PATH}` +
      (carried > 0 ? `\n${carried} existing label(s) carried forward.` : ""),
  );
  console.log("Label them with: pnpm review");
}

function wrap(text: string, width = 76, indent = "    "): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + word).length > width) {
      lines.push(line.trimEnd());
      line = "";
    }
    line += `${word} `;
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines.map((l) => indent + l).join("\n");
}

async function label(): Promise<void> {
  const file = load();
  const pending = file.items.filter((item) => item.label === null);

  if (pending.length === 0) {
    console.log("Everything is labelled. Run: pnpm review score");
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log(`\n${REVIEW_INSTRUCTIONS}\n`);
  console.log("Keys:  c=confirmed  d=drifted  f=fabricated  u=unsupported  ?=unclear");
  console.log("       s=skip  q=save and quit   (add a comment after the key)\n");

  if (!file.reviewer) {
    file.reviewer = (await rl.question("Your name (recorded in the eval): ")).trim();
  }

  let done = 0;
  for (const item of pending) {
    console.log("\n" + "=".repeat(80));
    console.log(`${item.domain}   ${done + 1} of ${pending.length}`);
    console.log("=".repeat(80));
    console.log("\n  QUESTION");
    console.log(wrap(item.question));
    console.log("\n  MODEL CLAIM");
    console.log(wrap(item.claim));
    console.log("\n  SITE SAYS");
    console.log(
      item.evidenceSpan
        ? wrap(`"${item.evidenceSpan}"`)
        : "    (no span cited — the adjudicator claims the ledger does not address this)",
    );
    if (item.sourceUrl) console.log(`\n    ${item.sourceUrl}`);
    console.log(`\n  ADJUDICATOR SAID: ${item.predicted}`);
    console.log(wrap(item.adjudicatorNote));

    const answer = (await rl.question("\n  your ruling > ")).trim();
    const key = answer.charAt(0).toLowerCase();

    if (key === "q") break;
    if (key === "s" || key === "") {
      done += 1;
      continue;
    }

    const ruling = KEYS[key];
    if (!ruling) {
      console.log("  unrecognised key — skipped");
      done += 1;
      continue;
    }

    item.label = ruling;
    item.comment = answer.slice(1).trim();
    done += 1;

    // Save after every item; a long labelling session must survive a crash.
    save(file);
  }

  rl.close();
  save(file);

  const remaining = file.items.filter((i) => i.label === null).length;
  console.log(`\nSaved. ${file.items.length - remaining}/${file.items.length} labelled.`);
  if (remaining > 0) console.log(`${remaining} remaining — run pnpm review again.`);
}

function score(): void {
  const file = load();
  const result = agreement(file.items);

  console.log(`\nAdjudicator vs ${file.reviewer || "reviewer"}`);
  console.log("=".repeat(60));
  console.log(`findings          ${result.total}`);
  console.log(`labelled          ${result.labelled}`);
  console.log(`unclear           ${result.unclear}  (excluded from accuracy)`);

  if (result.accuracy === null) {
    console.log("\nNothing scorable yet — label some findings first.");
    return;
  }

  const scored = result.labelled - result.unclear;
  console.log(`agreed            ${result.agreed}/${scored}`);
  console.log(`ACCURACY          ${(result.accuracy * 100).toFixed(1)}%`);

  console.log("\nby predicted ruling");
  for (const [ruling, stats] of Object.entries(result.byPredicted)) {
    const pct = stats.n > 0 ? ((stats.agreed / stats.n) * 100).toFixed(0) : "—";
    console.log(`  ${ruling.padEnd(12)} ${String(stats.agreed).padStart(3)}/${String(stats.n).padEnd(3)}  ${pct}%`);
  }

  if (result.confusions.length > 0) {
    console.log("\nmost common errors (adjudicator said -> you said)");
    for (const c of result.confusions.slice(0, 6)) {
      console.log(`  ${c.predicted.padEnd(12)} -> ${c.actual.padEnd(12)} ${c.n}`);
    }
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (command === "init") init(rest);
  else if (command === "score") score();
  else if (command === undefined || command === "label") await label();
  else {
    console.error("Usage: pnpm review [init <domain...> | label | score]");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
