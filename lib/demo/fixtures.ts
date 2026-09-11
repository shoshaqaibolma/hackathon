import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { FixtureSchema, type Fixture } from "@/lib/view/types";

/**
 * DEMO mode. The judge path.
 *
 * Fixtures are read from disk and validated — no database, no network, no
 * API key, no rate limit. /demo therefore keeps working if Neon is down, if
 * a free-tier quota is exhausted, or if DATABASE_URL was never set. That is
 * the entire point: this is the path that must never break.
 *
 * Files are traced into the Vercel bundle via `outputFileTracingIncludes`
 * in next.config.ts.
 */

const FIXTURE_DIR = join(process.cwd(), "fixtures");

export type FixtureLoadIssue = {
  file: string;
  message: string;
};

export type FixtureIndex = {
  fixtures: Fixture[];
  /** Files present but unreadable or failing validation. Reported, not hidden. */
  issues: FixtureLoadIssue[];
};

let cache: FixtureIndex | null = null;

function loadAll(): FixtureIndex {
  const fixtures: Fixture[] = [];
  const issues: FixtureLoadIssue[] = [];

  let files: string[];
  try {
    files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    // Directory absent — no fixtures recorded yet. Not an error state.
    return { fixtures, issues };
  }

  for (const file of files.sort()) {
    try {
      const raw = JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf8"));
      const parsed = FixtureSchema.safeParse(raw);

      if (!parsed.success) {
        issues.push({
          file,
          message: parsed.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; "),
        });
        continue;
      }

      fixtures.push(parsed.data);
    } catch (error) {
      issues.push({
        file,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { fixtures, issues };
}

export function getFixtureIndex(): FixtureIndex {
  // Fixtures are immutable build artefacts; parse once per server instance.
  if (cache === null || process.env.NODE_ENV === "development") {
    cache = loadAll();
  }
  return cache;
}

export function listFixtures(): Fixture[] {
  return getFixtureIndex().fixtures;
}

export function getFixture(slug: string): Fixture | null {
  return listFixtures().find((f) => f.slug === slug) ?? null;
}
