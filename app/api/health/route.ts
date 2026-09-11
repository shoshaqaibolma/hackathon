import { NextResponse } from "next/server";

import { HEALTH_CONFIG_SUMMARY, runHealthChecks } from "@/lib/health";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const report = await runHealthChecks();

  return NextResponse.json(
    { ...report, config: HEALTH_CONFIG_SUMMARY },
    { status: report.ok ? 200 : 503 },
  );
}
