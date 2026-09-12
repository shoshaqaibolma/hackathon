import { describe, expect, it } from "vitest";

import { buildCost } from "@/lib/view/from-database";
import {
  FIXTURE_VERSION,
  FixtureSchema,
  ScanViewSchema,
  type Fixture,
} from "@/lib/view/types";

/**
 * Synthetic data, used only to prove the format holds. Shipped fixtures are
 * always recordings of real scans — see scripts/record-fixture.ts.
 */
function minimalFixture(): unknown {
  return {
    fixtureVersion: FIXTURE_VERSION,
    slug: "example-com",
    headline: "Two models disagree about the Pro plan's API limits.",
    recordedAt: "2026-09-12T00:00:00.000Z",
    id: "scan_1",
    domain: "example.com",
    mode: "DEMO",
    status: "COMPLETE",
    parityScore: 47.2,
    interpretation: "Models don't really know you.",
    composition: {
      counts: { CONFIRMED: 1, DRIFTED: 1, UNSUPPORTED: 0, FABRICATED: 0 },
      weightShare: { CONFIRMED: 0.5, DRIFTED: 0.5, UNSUPPORTED: 0, FABRICATED: 0 },
      total: 2,
      totalWeight: 6,
    },
    createdAt: "2026-09-12T00:00:00.000Z",
    cost: {
      lines: [
        {
          stage: "ADJUDICATE",
          provider: "GOOGLE",
          model: "gemini-flash",
          calls: 2,
          cachedCalls: 1,
        },
      ],
      totalCalls: 2,
      cachedCalls: 1,
    },
    runs: [
      {
        id: "run_1",
        index: 0,
        label: "Baseline",
        parityScore: 47.2,
        composition: {
          counts: { CONFIRMED: 1, DRIFTED: 1, UNSUPPORTED: 0, FABRICATED: 0 },
          weightShare: {
            CONFIRMED: 0.5,
            DRIFTED: 0.5,
            UNSUPPORTED: 0,
            FABRICATED: 0,
          },
          total: 2,
          totalWeight: 6,
        },
        startedAt: "2026-09-12T00:00:00.000Z",
        driftCards: [
          {
            id: "v1",
            question: "Does the Pro plan include unlimited API calls?",
            questionCategory: "PRICING",
            model: "gemini-flash",
            modelLabel: "Gemini Flash",
            provider: "GOOGLE",
            condition: "BROWSING",
            claimText: "The Pro plan comes with unlimited API access.",
            ruling: "DRIFTED",
            confidence: 0.91,
            reasoning: "The page states a 10,000/month cap.",
            weight: 3,
            askedAt: "2026-09-12T00:00:00.000Z",
          },
        ],
      },
    ],
  };
}

describe("FixtureSchema", () => {
  it("accepts a minimal fixture and applies defaults", () => {
    const parsed = FixtureSchema.parse(minimalFixture()) satisfies Fixture;

    expect(parsed.slug).toBe("example-com");
    // Optional collections default rather than being required at every site.
    expect(parsed.facts).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.runs[0].driftCards[0].retrieval).toEqual([]);
    expect(parsed.runs[0].driftCards[0].groundTruth).toBeNull();
    expect(parsed.runs[0].driftCards[0].downgraded).toBe(false);
  });

  it("is a strict superset of ScanViewSchema", () => {
    // The fixture format must stay assignable to the shared view model,
    // or /demo and live scans would render through different shapes.
    const fixture = FixtureSchema.parse(minimalFixture());
    expect(() => ScanViewSchema.parse(fixture)).not.toThrow();
  });

  it("rejects a fixture from a different format version", () => {
    const stale = { ...(minimalFixture() as object), fixtureVersion: 99 };
    expect(FixtureSchema.safeParse(stale).success).toBe(false);
  });

  it("rejects an unknown ruling rather than rendering it blank", () => {
    const bad = minimalFixture() as {
      runs: { driftCards: { ruling: string }[] }[];
    };
    bad.runs[0].driftCards[0].ruling = "PROBABLY_FINE";
    expect(FixtureSchema.safeParse(bad).success).toBe(false);
  });
});

describe("buildCost", () => {
  const call = (over: Partial<Parameters<typeof buildCost>[0][number]> = {}) => ({
    stage: "ADJUDICATE",
    provider: "GOOGLE" as const,
    model: "gemini-flash",
    cached: false,
    inputTokens: 100,
    outputTokens: 50,
    costUsd: null,
    ...over,
  });

  it("groups by stage and model", () => {
    const cost = buildCost([call(), call(), call({ stage: "FACTS" })]);
    expect(cost.lines).toHaveLength(2);
    expect(cost.totalCalls).toBe(3);
  });

  it("counts cached calls separately so nobody thinks they paid twice", () => {
    const cost = buildCost([call({ cached: true }), call(), call({ cached: true })]);
    expect(cost.cachedCalls).toBe(2);
    expect(cost.lines[0].cachedCalls).toBe(2);
    expect(cost.lines[0].calls).toBe(3);
  });

  it("reports null total cost for free-tier providers, not $0.00", () => {
    // A free-tier scan has no price; showing $0.00 would imply it was metered.
    const cost = buildCost([call(), call()]);
    expect(cost.totalCostUsd).toBeNull();
  });

  it("sums cost when any call is priced", () => {
    const cost = buildCost([call({ costUsd: 0.01 }), call({ costUsd: 0.02 })]);
    expect(cost.totalCostUsd).toBeCloseTo(0.03);
  });
});

describe("publication rule", () => {
  function cardFrom(over: Record<string, unknown>) {
    const fixture = minimalFixture() as {
      runs: { driftCards: Record<string, unknown>[] }[];
    };
    Object.assign(fixture.runs[0].driftCards[0], over);
    return FixtureSchema.safeParse(fixture);
  }

  it("requires a timestamp on every finding", () => {
    expect(cardFrom({ askedAt: "" }).success).toBe(false);
  });

  it("requires the model's exact words", () => {
    // A finding is a claim about what a model said. Without the quote there
    // is nothing to publish.
    expect(cardFrom({ claimText: "" }).success).toBe(false);
  });

  it("requires a capture date whenever a source is cited", () => {
    const result = cardFrom({
      groundTruth: {
        id: "f1",
        statement: "Pro includes 10,000 API calls per month.",
        category: "PRICING",
        evidenceSpan: "10,000 API calls per month",
        sourceUrl: "https://example.com/pricing",
      },
      sourceCapturedAt: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain("Publication rule");
    }
  });

  it("requires a non-empty quoted span whenever a source is cited", () => {
    const result = cardFrom({
      groundTruth: {
        id: "f1",
        statement: "Pro includes 10,000 API calls per month.",
        category: "PRICING",
        evidenceSpan: "   ",
        sourceUrl: "https://example.com/pricing",
      },
      sourceCapturedAt: "2026-09-12T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a fully evidenced finding", () => {
    expect(
      cardFrom({
        groundTruth: {
          id: "f1",
          statement: "Pro includes 10,000 API calls per month.",
          category: "PRICING",
          evidenceSpan: "10,000 API calls per month",
          sourceUrl: "https://example.com/pricing",
        },
        sourceCapturedAt: "2026-09-12T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("allows no source on findings that cite nothing", () => {
    // FABRICATED and UNSUPPORTED have no page span by definition; the rule
    // must not make them unpublishable.
    expect(cardFrom({ ruling: "FABRICATED", groundTruth: null }).success).toBe(true);
  });
});
