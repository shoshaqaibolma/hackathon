import { generateText } from "ai";

import { CAPS, MODE_CAPS } from "@/lib/config";
import { prisma } from "@/lib/db";
import {
  FREE_PANEL,
  adjudicatorFor,
  hasServerKey,
  languageModel,
  providerLabel,
  type ModelRef,
  type ProviderId,
} from "@/lib/llm/models";
import { scrubError } from "@/lib/llm/scrub";
import { PROVIDER_LIMITS } from "@/lib/llm/ratelimit";
import { getSearchProvider, isSearchConfigured } from "@/lib/search/tavily";

export type CheckStatus = "pass" | "fail" | "skip";

export type Check = {
  name: string;
  status: CheckStatus;
  detail: string;
  durationMs?: number;
};

export type HealthReport = {
  ok: boolean;
  checkedAt: string;
  checks: Check[];
};

async function timed(name: string, fn: () => Promise<Check>): Promise<Check> {
  const started = Date.now();
  try {
    const check = await fn();
    return { ...check, durationMs: Date.now() - started };
  } catch (error) {
    return {
      name,
      status: "fail",
      detail: scrubError(error),
      durationMs: Date.now() - started,
    };
  }
}

/**
 * DEMO mode deliberately has no runtime dependencies, so it is checked
 * separately and first: if everything else is red, /demo must still be green.
 */
async function checkDemo(): Promise<Check> {
  const { listFixtures, getFixtureIndex } = await import("@/lib/demo/fixtures");
  const { issues } = getFixtureIndex();
  const fixtures = listFixtures();

  if (issues.length > 0) {
    return {
      name: "Demo fixtures",
      status: "fail",
      detail: `${issues.length} fixture file(s) failed validation: ${issues
        .map((i) => i.file)
        .join(", ")}`,
    };
  }

  if (fixtures.length === 0) {
    return {
      name: "Demo fixtures",
      status: "skip",
      detail:
        "No fixtures recorded yet. Run `pnpm demo:record <scanId> <slug>` once a scan completes.",
    };
  }

  return {
    name: "Demo fixtures",
    status: "pass",
    detail: `${fixtures.length} scan(s) served from disk: ${fixtures
      .map((f) => f.domain)
      .join(", ")}`,
  };
}

async function checkDatabase(): Promise<Check> {
  if (!process.env.DATABASE_URL) {
    return {
      name: "Database",
      status: "skip",
      detail: "DATABASE_URL not set. DEMO mode does not need it; FREE and BYOK do.",
    };
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    return { name: "Database", status: "fail", detail: scrubError(error) };
  }

  try {
    const scans = await prisma.scan.count();
    return {
      name: "Database",
      status: "pass",
      detail: `Connected. Schema applied, ${scans} scan${scans === 1 ? "" : "s"} stored.`,
    };
  } catch {
    return {
      name: "Database",
      status: "fail",
      detail: "Connected, but the schema is missing. Run `pnpm db:migrate`.",
    };
  }
}

/** One cheap call per panel member, proving the free-tier key actually works. */
async function checkModel(ref: ModelRef): Promise<Check> {
  const name = `${ref.label} (${providerLabel(ref.provider)})`;

  if (!hasServerKey(ref.provider)) {
    return {
      name,
      status: "skip",
      detail: `No server key for ${ref.provider}. FREE mode cannot use this model.`,
    };
  }

  try {
    const result = await generateText({
      model: languageModel(ref),
      prompt: "Reply with the single word: ok",
      maxOutputTokens: 16,
    });
    const limits = PROVIDER_LIMITS[ref.provider];
    return {
      name,
      status: "pass",
      detail: `Responded "${result.text.trim().slice(0, 24)}" · paced at ${limits.rpm} rpm / ${limits.tpm.toLocaleString()} tpm.`,
    };
  } catch (error) {
    return { name, status: "fail", detail: scrubError(error) };
  }
}

/**
 * The BROWSING condition is load-bearing: it is what separates "your site is
 * wrong" from "your site is invisible". If retrieval is not working, browsing
 * silently degrades into memory and the whole diagnostic is void — so this
 * runs a real query, not a ping.
 */
async function checkSearch(): Promise<Check> {
  if (!isSearchConfigured()) {
    return {
      name: "Search (browsing condition)",
      status: "skip",
      detail:
        "TAVILY_API_KEY not set. The browsing condition will report itself as unavailable rather than silently behaving like memory.",
    };
  }

  const result = await getSearchProvider().search("anthropic claude pricing", 3);

  if (result.error) {
    return {
      name: "Search (browsing condition)",
      status: "fail",
      detail: result.error,
    };
  }

  if (result.snippets.length === 0) {
    return {
      name: "Search (browsing condition)",
      status: "fail",
      detail: "Search succeeded but returned no results.",
    };
  }

  return {
    name: "Search (browsing condition)",
    status: "pass",
    detail: `${result.snippets.length} snippet(s) via ${result.provider} in ${result.latencyMs}ms.`,
  };
}

export async function runHealthChecks(): Promise<HealthReport> {
  const checks = await Promise.all([
    timed("Demo fixtures", checkDemo),
    timed("Database", checkDatabase),
    timed("Search (browsing condition)", checkSearch),
    ...FREE_PANEL.map((ref) => timed(ref.label, () => checkModel(ref))),
  ]);

  return {
    ok: checks.every((check) => check.status !== "fail"),
    checkedAt: new Date().toISOString(),
    checks,
  };
}

export function healthConfigSummary() {
  const byokProviders: ProviderId[] = ["ANTHROPIC", "OPENAI", "GOOGLE", "GROQ"];

  return {
    panel: FREE_PANEL.map((m) => m.label),
    adjudicator: adjudicatorFor(null).label,
    byokProviders,
    freeCaps: `${MODE_CAPS.FREE.maxPages} pages · ${MODE_CAPS.FREE.maxQuestions} questions · ${MODE_CAPS.FREE.maxPanelModels} model`,
    byokCaps: `${MODE_CAPS.BYOK.maxPages} pages · ${MODE_CAPS.BYOK.maxQuestions} questions · ${MODE_CAPS.BYOK.maxPanelModels} models`,
    concurrency: CAPS.CONCURRENCY,
    searchResults: CAPS.SEARCH_RESULTS,
  };
}
