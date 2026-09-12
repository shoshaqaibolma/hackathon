import type { FactCategory, Ruling } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  clamp,
  composition,
  interpret,
  interpretWrongShare,
  parityScore,
  weightFor,
  wrongShare,
  type ScorableVerdict,
} from "@/lib/score";

function verdict(
  ruling: Ruling,
  citedFactCategory: FactCategory | null = "GENERAL",
  questionCategory: FactCategory | null = null,
): ScorableVerdict {
  return { ruling, citedFactCategory, questionCategory };
}

function repeat(v: ScorableVerdict, n: number): ScorableVerdict[] {
  return Array.from({ length: n }, () => v);
}

describe("weightFor", () => {
  it("uses the cited fact's category first", () => {
    expect(weightFor(verdict("CONFIRMED", "PRICING", "GENERAL"))).toBe(3);
  });

  it("falls back to the question's category when no fact was cited", () => {
    // A fabricated price has no fact to cite, but must still carry the
    // severity of the question that produced it.
    expect(weightFor(verdict("FABRICATED", null, "PRICING"))).toBe(3);
  });

  it("falls back to GENERAL when neither is available", () => {
    expect(weightFor(verdict("UNSUPPORTED", null, null))).toBe(1);
  });

  it("weights each category as published", () => {
    const expected: Record<FactCategory, number> = {
      PRICING: 3,
      ELIGIBILITY: 3,
      LIMITS: 2,
      COMPATIBILITY: 2,
      API: 2,
      GENERAL: 1,
    };
    for (const [category, weight] of Object.entries(expected)) {
      expect(weightFor(verdict("CONFIRMED", category as FactCategory))).toBe(
        weight,
      );
    }
  });
});

describe("parityScore", () => {
  it("returns null for an empty verdict set, not 50", () => {
    // "No data" must never render as the neutral midpoint.
    expect(parityScore([])).toBeNull();
  });

  it("scores 100 when everything is confirmed", () => {
    expect(parityScore(repeat(verdict("CONFIRMED"), 7))).toBe(100);
  });

  it("scores 0 when everything is fabricated", () => {
    expect(parityScore(repeat(verdict("FABRICATED"), 7))).toBe(0);
  });

  it("scores 50 when everything is unsupported", () => {
    expect(parityScore(repeat(verdict("UNSUPPORTED"), 7))).toBe(50);
  });

  it("scores 25 when everything is drifted — distinct from unsupported", () => {
    // This is the whole point of DRIFTED = -0.5. If drift and absence both
    // scored 50, the headline number would collapse the two failure modes
    // Parity exists to separate.
    expect(parityScore(repeat(verdict("DRIFTED"), 7))).toBe(25);
    expect(parityScore(repeat(verdict("DRIFTED"), 7))).not.toBe(
      parityScore(repeat(verdict("UNSUPPORTED"), 7)),
    );
  });

  it("weights a pricing error more heavily than a general one", () => {
    const pricingWrong = [
      verdict("FABRICATED", "PRICING"),
      verdict("CONFIRMED", "GENERAL"),
    ];
    const generalWrong = [
      verdict("FABRICATED", "GENERAL"),
      verdict("CONFIRMED", "PRICING"),
    ];
    expect(parityScore(pricingWrong)!).toBeLessThan(parityScore(generalWrong)!);
  });

  it("matches a hand-computed mixed fixture", () => {
    // CONFIRMED/PRICING   w=3  s=+1   -> +3
    // DRIFTED/PRICING     w=3  s=-0.5 -> -1.5
    // FABRICATED/(q:API)  w=2  s=-1   -> -2
    // UNSUPPORTED/GENERAL w=1  s=0    ->  0
    // Σ(w*s) = -0.5 ; Σ(w) = 9 ; 50 + 50*(-0.5/9) = 47.2222...
    const verdicts = [
      verdict("CONFIRMED", "PRICING"),
      verdict("DRIFTED", "PRICING"),
      verdict("FABRICATED", null, "API"),
      verdict("UNSUPPORTED", "GENERAL"),
    ];
    expect(parityScore(verdicts)!).toBeCloseTo(47.2222, 3);
  });

  it("never leaves the 0..100 range", () => {
    for (const ruling of [
      "CONFIRMED",
      "DRIFTED",
      "UNSUPPORTED",
      "FABRICATED",
    ] as Ruling[]) {
      const score = parityScore(repeat(verdict(ruling, "PRICING"), 40))!;
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});

describe("clamp", () => {
  it("bounds on both sides and passes through the middle", () => {
    expect(clamp(-10, 0, 100)).toBe(0);
    expect(clamp(150, 0, 100)).toBe(100);
    expect(clamp(42, 0, 100)).toBe(42);
  });
});

describe("composition", () => {
  it("is all zeroes for an empty set without dividing by zero", () => {
    const result = composition([]);
    expect(result.total).toBe(0);
    expect(result.totalWeight).toBe(0);
    expect(result.weightShare.CONFIRMED).toBe(0);
  });

  it("counts rulings and shares weight, not count", () => {
    // One PRICING confirmation (w=3) and one GENERAL fabrication (w=1):
    // counts are 50/50 but weight share is 75/25.
    const result = composition([
      verdict("CONFIRMED", "PRICING"),
      verdict("FABRICATED", "GENERAL"),
    ]);
    expect(result.counts.CONFIRMED).toBe(1);
    expect(result.counts.FABRICATED).toBe(1);
    expect(result.weightShare.CONFIRMED).toBeCloseTo(0.75);
    expect(result.weightShare.FABRICATED).toBeCloseTo(0.25);
  });

  it("weight shares sum to 1", () => {
    const result = composition([
      verdict("CONFIRMED", "PRICING"),
      verdict("DRIFTED", "API"),
      verdict("FABRICATED", null, "ELIGIBILITY"),
      verdict("UNSUPPORTED", null, null),
    ]);
    const sum = Object.values(result.weightShare).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1);
  });
});

describe("interpret", () => {
  it("distinguishes absence from being wrong", () => {
    expect(interpret(null)).toMatch(/nothing to score/i);
    expect(interpret(50)).toMatch(/don't really know you/i);
    expect(interpret(25)).toMatch(/confidently wrong/i);
    expect(interpret(90)).toMatch(/get you right/i);
  });
});

describe("wrongShare — the headline number", () => {
  it("excludes UNSUPPORTED from the denominator", () => {
    // This is the whole point: the Parity Score's ceiling is set by ledger
    // coverage, so a perfect record can still score in the sixties. The
    // headline number must not inherit that problem.
    const result = wrongShare([
      verdict("CONFIRMED"),
      verdict("CONFIRMED"),
      verdict("UNSUPPORTED"),
      verdict("UNSUPPORTED"),
    ]);
    expect(result.checkable).toBe(2);
    expect(result.share).toBe(0);
  });

  it("counts drift and fabrication as wrong", () => {
    const result = wrongShare([
      verdict("CONFIRMED"),
      verdict("DRIFTED"),
      verdict("FABRICATED"),
      verdict("UNSUPPORTED"),
    ]);
    expect(result.wrong).toBe(2);
    expect(result.checkable).toBe(3);
    expect(result.share).toBeCloseTo(2 / 3);
  });

  it("reports the Notion case as a perfect record", () => {
    // Notion scored 68.2 on the Parity Score with zero errors.
    const verdicts = [
      ...repeat(verdict("CONFIRMED"), 4),
      ...repeat(verdict("UNSUPPORTED"), 7),
    ];
    expect(wrongShare(verdicts).share).toBe(0);
    expect(parityScore(verdicts)!).toBeLessThan(70);
  });

  it("returns null rather than 0% when nothing was checkable", () => {
    // 0% wrong would read as a perfect score; it is an absence of data.
    expect(wrongShare(repeat(verdict("UNSUPPORTED"), 5)).share).toBeNull();
    expect(wrongShare([]).share).toBeNull();
  });
});

describe("interpretWrongShare", () => {
  it("distinguishes a perfect record from no data", () => {
    expect(
      interpretWrongShare(wrongShare(repeat(verdict("CONFIRMED"), 3))),
    ).toMatch(/every one of the 3/i);
    expect(
      interpretWrongShare(wrongShare(repeat(verdict("UNSUPPORTED"), 3))),
    ).toMatch(/could be checked/i);
  });

  it("states the count, not just a percentage", () => {
    const text = interpretWrongShare(
      wrongShare([verdict("DRIFTED"), verdict("CONFIRMED")]),
    );
    expect(text).toContain("1 of 2");
  });
});
