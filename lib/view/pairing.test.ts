import { describe, expect, it } from "vitest";

import { diagnose, heroCards, pairByCondition } from "@/lib/view/pairing";
import type { DriftCard } from "@/lib/view/types";

function card(over: Partial<DriftCard> = {}): DriftCard {
  return {
    id: Math.random().toString(36).slice(2),
    question: "Does Heroku still offer a free dyno tier?",
    questionCategory: "PRICING",
    model: "qwen/qwen3.8-27b",
    modelLabel: "Qwen 3.8 27B",
    provider: "GROQ",
    condition: "MEMORY",
    latencyMs: 900,
    claimText: "Heroku offers a free dyno tier.",
    answerExcerpt: null,
    ruling: "DRIFTED",
    confidence: 0.9,
    reasoning: "The page states free dynos were removed.",
    downgraded: false,
    groundTruth: null,
    evidenceQuote: null,
    searchQuery: null,
    retrieval: [],
    remediation: null,
    weight: 3,
    askedAt: "2026-09-12T00:00:00.000Z",
    sourceCapturedAt: null,
    ...over,
  };
}

describe("diagnose — the two-condition matrix", () => {
  it("wrong from memory, right with search = stale training data", () => {
    expect(
      diagnose(card({ ruling: "DRIFTED" }), card({ ruling: "CONFIRMED" })),
    ).toBe("STALE_TRAINING");
  });

  it("wrong in both = the site is wrong or silent", () => {
    // The highest-value diagnosis: retrieval did not rescue it, so the
    // correct answer is not findable on the site.
    expect(
      diagnose(card({ ruling: "FABRICATED" }), card({ ruling: "DRIFTED" })),
    ).toBe("SITE_WRONG_OR_SILENT");
  });

  it("right from memory, wrong with search = outranked", () => {
    expect(
      diagnose(card({ ruling: "CONFIRMED" }), card({ ruling: "DRIFTED" })),
    ).toBe("OUTRANKED");
  });

  it("right in both = parity", () => {
    expect(
      diagnose(card({ ruling: "CONFIRMED" }), card({ ruling: "CONFIRMED" })),
    ).toBe("PARITY");
  });

  it("treats UNSUPPORTED as uncomparable rather than as correct", () => {
    // UNSUPPORTED means the ledger never addressed the claim. Counting it as
    // "right" would report parity for a question the site never answers.
    expect(
      diagnose(card({ ruling: "UNSUPPORTED" }), card({ ruling: "CONFIRMED" })),
    ).toBe("PARTIAL");
    expect(
      diagnose(card({ ruling: "CONFIRMED" }), card({ ruling: "UNSUPPORTED" })),
    ).toBe("PARTIAL");
  });

  it("is PARTIAL when a condition is missing entirely", () => {
    expect(diagnose(card(), null)).toBe("PARTIAL");
    expect(diagnose(null, card())).toBe("PARTIAL");
  });
});

describe("pairByCondition", () => {
  it("pairs the same question across both conditions", () => {
    const pairs = pairByCondition([
      card({ condition: "MEMORY", ruling: "DRIFTED" }),
      card({ condition: "BROWSING", ruling: "CONFIRMED" }),
    ]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].memory?.ruling).toBe("DRIFTED");
    expect(pairs[0].browsing?.ruling).toBe("CONFIRMED");
    expect(pairs[0].diagnosis).toBe("STALE_TRAINING");
  });

  it("NEVER pairs across different models", () => {
    // Comparing one model's memory to another's browsing would attribute a
    // difference between models to the difference between conditions — the
    // one confound this design exists to avoid.
    const pairs = pairByCondition([
      card({ condition: "MEMORY", model: "a", ruling: "DRIFTED" }),
      card({ condition: "BROWSING", model: "b", ruling: "CONFIRMED" }),
    ]);

    expect(pairs).toHaveLength(2);
    expect(pairs.every((p) => p.diagnosis === "PARTIAL")).toBe(true);
  });

  it("does not pair different questions", () => {
    const pairs = pairByCondition([
      card({ condition: "MEMORY", question: "Q1" }),
      card({ condition: "BROWSING", question: "Q2" }),
    ]);
    expect(pairs).toHaveLength(2);
  });

  it("keeps the most severe finding when an answer yielded several", () => {
    const pairs = pairByCondition([
      card({ condition: "MEMORY", ruling: "CONFIRMED" }),
      card({ condition: "MEMORY", ruling: "FABRICATED" }),
      card({ condition: "BROWSING", ruling: "CONFIRMED" }),
    ]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].memory?.ruling).toBe("FABRICATED");
  });

  it("ranks site-is-wrong above stale-training above parity", () => {
    const pairs = pairByCondition([
      card({ question: "A", condition: "MEMORY", ruling: "CONFIRMED" }),
      card({ question: "A", condition: "BROWSING", ruling: "CONFIRMED" }),
      card({ question: "B", condition: "MEMORY", ruling: "DRIFTED" }),
      card({ question: "B", condition: "BROWSING", ruling: "CONFIRMED" }),
      card({ question: "C", condition: "MEMORY", ruling: "DRIFTED" }),
      card({ question: "C", condition: "BROWSING", ruling: "DRIFTED" }),
    ]);

    expect(pairs.map((p) => p.diagnosis)).toEqual([
      "SITE_WRONG_OR_SILENT",
      "STALE_TRAINING",
      "PARITY",
    ]);
  });

  it("weights a pricing contrast above a general one", () => {
    const pairs = pairByCondition([
      card({ question: "gen", questionCategory: "GENERAL", weight: 1, condition: "MEMORY", ruling: "DRIFTED" }),
      card({ question: "gen", questionCategory: "GENERAL", weight: 1, condition: "BROWSING", ruling: "DRIFTED" }),
      card({ question: "price", questionCategory: "PRICING", weight: 3, condition: "MEMORY", ruling: "DRIFTED" }),
      card({ question: "price", questionCategory: "PRICING", weight: 3, condition: "BROWSING", ruling: "DRIFTED" }),
    ]);

    expect(pairs[0].question).toBe("price");
  });

  it("returns nothing for no input", () => {
    expect(pairByCondition([])).toEqual([]);
  });
});

describe("heroCards", () => {
  it("selects only pairs where the two conditions actually differ", () => {
    const pairs = pairByCondition([
      card({ question: "A", condition: "MEMORY", ruling: "CONFIRMED" }),
      card({ question: "A", condition: "BROWSING", ruling: "CONFIRMED" }),
      card({ question: "B", condition: "MEMORY", ruling: "DRIFTED" }),
      card({ question: "B", condition: "BROWSING", ruling: "CONFIRMED" }),
    ]);

    const heroes = heroCards(pairs);
    // A parity pair makes the same point as a standard card and does not
    // earn the extra space.
    expect(heroes).toHaveLength(1);
    expect(heroes[0].question).toBe("B");
  });

  it("excludes incomparable pairs", () => {
    const pairs = pairByCondition([card({ condition: "MEMORY" })]);
    expect(heroCards(pairs)).toEqual([]);
  });

  it("honours the limit", () => {
    const cards = ["A", "B", "C"].flatMap((q) => [
      card({ question: q, condition: "MEMORY", ruling: "DRIFTED" }),
      card({ question: q, condition: "BROWSING", ruling: "DRIFTED" }),
    ]);
    expect(heroCards(pairByCondition(cards), 2)).toHaveLength(2);
  });
});
