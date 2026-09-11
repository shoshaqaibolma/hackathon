/**
 * Freeze a real scan into a DEMO fixture.
 *
 *   pnpm demo:record <scanId> <slug> "<headline>"
 *
 * Fixtures are never hand-authored. This is the only way one is created, so
 * everything on /demo is a recording of something that actually happened.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildScanView } from "@/lib/view/from-database";
import { FIXTURE_VERSION, FixtureSchema } from "@/lib/view/types";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Absent is fine.
  }
}

async function main() {
  const [scanId, slug, headline] = process.argv.slice(2);

  if (!scanId || !slug) {
    console.error(
      'Usage: pnpm demo:record <scanId> <slug> "<headline>"\n' +
        "  scanId    the Scan.id to freeze\n" +
        "  slug      URL segment: /demo/<slug>\n" +
        "  headline  one line describing what this scan demonstrates",
    );
    process.exit(1);
  }

  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    console.error(`Invalid slug "${slug}" — use lowercase letters, digits, hyphens.`);
    process.exit(1);
  }

  const view = await buildScanView(scanId);
  if (!view) {
    console.error(`No scan found with id ${scanId}.`);
    process.exit(1);
  }

  const verdictCount = view.runs.reduce((n, r) => n + r.driftCards.length, 0);
  if (verdictCount === 0) {
    console.error(
      `Scan ${scanId} has no verdicts. Record a scan that actually completed ` +
        "adjudication, or /demo will show an empty finding list.",
    );
    process.exit(1);
  }

  const fixture = FixtureSchema.parse({
    ...view,
    fixtureVersion: FIXTURE_VERSION,
    slug,
    headline: headline ?? `Parity scan of ${view.domain}`,
    recordedAt: new Date().toISOString(),
  });

  const dir = join(process.cwd(), "fixtures");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${slug}.json`);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");

  console.log(
    `Recorded ${path}\n` +
      `  domain    ${fixture.domain}\n` +
      `  score     ${fixture.parityScore ?? "—"}\n` +
      `  facts     ${fixture.facts.length}\n` +
      `  questions ${fixture.questions.length}\n` +
      `  verdicts  ${verdictCount}\n` +
      `  cached    ${fixture.cost.cachedCalls}/${fixture.cost.totalCalls} calls`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
