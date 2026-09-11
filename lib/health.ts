import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

import {
  CAPS,
  MODELS,
  WEB_SEARCH_MAX_USES,
  getPanel,
  type PanelMember,
} from "@/lib/config";
import { prisma } from "@/lib/db";

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

async function timed(fn: () => Promise<Check>): Promise<Check> {
  const started = Date.now();
  try {
    const check = await fn();
    return { ...check, durationMs: Date.now() - started };
  } catch (error) {
    return {
      name: "unknown",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
    };
  }
}

function checkEnv(): Check {
  const required = ["DATABASE_URL", "DIRECT_URL", "ANTHROPIC_API_KEY"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    return {
      name: "Environment",
      status: "fail",
      detail: `Missing: ${missing.join(", ")}. Add them to .env.local (local) or the Vercel project settings.`,
    };
  }

  return {
    name: "Environment",
    status: "pass",
    detail: `${required.length} required variables present.`,
  };
}

async function checkDatabase(): Promise<Check> {
  if (!process.env.DATABASE_URL) {
    return {
      name: "Database",
      status: "skip",
      detail: "DATABASE_URL not set — cannot connect.",
    };
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    return {
      name: "Database",
      status: "fail",
      detail: `Connection failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // Connecting is not enough — the migration must actually have been applied.
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

async function checkModel(): Promise<Check> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      name: `Model reachable (${MODELS.FAST})`,
      status: "skip",
      detail: "ANTHROPIC_API_KEY not set.",
    };
  }

  try {
    const result = await generateText({
      model: anthropic(MODELS.FAST),
      prompt: "Reply with the single word: ok",
      maxOutputTokens: 16,
    });

    return {
      name: `Model reachable (${MODELS.FAST})`,
      status: "pass",
      detail: `Responded "${result.text.trim().slice(0, 40)}" · ${result.usage.totalTokens ?? "?"} tokens.`,
    };
  } catch (error) {
    return {
      name: `Model reachable (${MODELS.FAST})`,
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The BROWSING condition is load-bearing: it is what separates "your site is
 * wrong" from "your site is invisible". If a panel member cannot actually
 * invoke web search, that member's browsing results are meaningless and we
 * need to know before Phase 3, not during a demo.
 *
 * Anthropic's docs are circular on per-model web-search support, so this
 * check answers the question empirically and keeps answering it.
 */
async function checkWebSearch(member: PanelMember): Promise<Check> {
  const name = `Web search · ${member.label}`;

  if (member.provider !== "anthropic") {
    return {
      name,
      status: "skip",
      detail: "Non-Anthropic panel member — probe not implemented.",
    };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return { name, status: "skip", detail: "ANTHROPIC_API_KEY not set." };
  }

  try {
    const result = await generateText({
      model: anthropic(member.id),
      // Phrased so that answering from parametric memory is not an option.
      prompt:
        "Search the web for today's date and the name of one news story published today. Answer in one sentence.",
      tools: {
        web_search: anthropic.tools.webSearch_20250305({
          maxUses: WEB_SEARCH_MAX_USES,
        }),
      },
      maxOutputTokens: 512,
    });

    const searched = result.toolCalls.length > 0 || result.sources.length > 0;

    if (!searched) {
      return {
        name,
        status: "fail",
        detail:
          "Accepted the tool but never invoked it. BROWSING would be indistinguishable from MEMORY for this model.",
      };
    }

    return {
      name,
      status: "pass",
      detail: `${result.toolCalls.length} search call(s), ${result.sources.length} source(s) returned.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name,
      status: "fail",
      detail: `Tool rejected: ${message}`,
    };
  }
}

export async function runHealthChecks(): Promise<HealthReport> {
  const env = checkEnv();

  const [database, model, ...webSearch] = await Promise.all([
    timed(async () => checkDatabase()),
    timed(async () => checkModel()),
    ...getPanel().map((member) => timed(async () => checkWebSearch(member))),
  ]);

  const checks = [env, database, model, ...webSearch];

  return {
    ok: checks.every((check) => check.status !== "fail"),
    checkedAt: new Date().toISOString(),
    checks,
  };
}

export const HEALTH_CONFIG_SUMMARY = {
  fastModel: MODELS.FAST,
  writerModel: MODELS.WRITER,
  judgeModel: MODELS.JUDGE,
  panel: getPanel().map((m) => m.label),
  maxPages: CAPS.MAX_PAGES,
  defaultQuestions: CAPS.DEFAULT_QUESTIONS,
  concurrency: CAPS.CONCURRENCY,
};
