import { describe, expect, it } from "vitest";

import {
  filterClaims,
  isHedge,
  isRefusal,
  verifyClaim,
} from "@/lib/pipeline/claims";

/**
 * Both behaviours here were found by a real screening run against stripe.com,
 * where hedges scored as DRIFTED and one claim had been silently rewritten
 * into the correct answer. See lib/pipeline/claims.ts for why each matters.
 */

describe("isHedge", () => {
  it("detects the refusals seen in the wild", () => {
    for (const text of [
      'I am not sure what specific service or platform "Tax Basic" refers to',
      "I cannot provide specific numbers, prices, or limits.",
      "I don't have access to current pricing information.",
      "As of my last knowledge update, this may have changed.",
      "Please check the official website for current pricing.",
      "I would recommend consulting their documentation.",
      "It is unclear whether this plan still exists.",
      "Unfortunately, I can't confirm that.",
    ]) {
      expect(isHedge(text), text).toBe(true);
    }
  });

  it("does not flag real assertions", () => {
    for (const text of [
      "The Pro plan costs $49 per month.",
      "Stripe Tax Complete starts at $90 per month.",
      "There is no free trial for this product.",
      "The API supports exporting reports as CSV.",
    ]) {
      expect(isHedge(text), text).toBe(false);
    }
  });

  it("treats empty text as a hedge rather than a claim", () => {
    expect(isHedge("   ")).toBe(true);
  });

  it("does not flag a confident negative claim", () => {
    // "There is no X" is a checkable assertion and is often exactly the
    // drift we are looking for. It must not be confused with a refusal.
    expect(isHedge("There is no plan called Tax Complete.")).toBe(false);
  });
});

describe("verifyClaim", () => {
  const answer =
    "The Pro plan costs $49 per month and includes 10,000 API calls. " +
    "There is no free trial available for new customers.";

  it("accepts a verbatim quote", () => {
    expect(verifyClaim(answer, "The Pro plan costs $49 per month")).toBe("exact");
  });

  it("accepts a quote differing only in whitespace and case", () => {
    expect(verifyClaim(answer, "the pro plan   costs $49 per MONTH")).toBe("exact");
  });

  it("accepts a close paraphrase", () => {
    expect(
      verifyClaim(answer, "Pro plan costs $49 per month, includes 10,000 API calls"),
    ).toBe("paraphrase");
  });

  it("rejects a claim the model never made", () => {
    expect(verifyClaim(answer, "Enterprise customers receive a dedicated CSM")).toBe(
      "unverified",
    );
  });

  it("rejects an INVERTED claim", () => {
    // The bug that produced a CONFIRMED finding whose own note said the
    // model had claimed the opposite. The extractor had written down the
    // truth instead of what the model said.
    expect(
      verifyClaim(
        "There is no standard free trial for Stripe Sigma.",
        "New users are eligible for a 30-day free trial of Stripe Sigma.",
      ),
    ).toBe("unverified");
  });

  it("rejects an empty or punctuation-only claim", () => {
    expect(verifyClaim(answer, "...")).toBe("unverified");
  });
});

describe("filterClaims", () => {
  const answer =
    "The Pro plan costs $49 per month. I am not sure whether a free trial exists. " +
    "The API supports CSV export.";

  it("keeps assertions and drops hedges", () => {
    const result = filterClaims(answer, [
      "The Pro plan costs $49 per month",
      "I am not sure whether a free trial exists",
      "The API supports CSV export",
    ]);

    expect(result.claims.map((c) => c.text)).toEqual([
      "The Pro plan costs $49 per month",
      "The API supports CSV export",
    ]);
    expect(result.dropped).toBe(1);
    expect(result.droppedReasons[0]).toContain("hedge");
  });

  it("drops claims that were rewritten rather than quoted", () => {
    const result = filterClaims(answer, ["The Pro plan costs $99 per year"]);
    expect(result.claims).toHaveLength(0);
    expect(result.droppedReasons[0]).toContain("not found in the answer");
  });

  it("deduplicates repeated claims", () => {
    const result = filterClaims(answer, [
      "The Pro plan costs $49 per month",
      "the pro plan costs $49 per month",
    ]);
    expect(result.claims).toHaveLength(1);
  });

  it("records verification level so paraphrases stay visible", () => {
    const result = filterClaims(answer, ["The Pro plan costs $49 per month"]);
    expect(result.claims[0].verification).toBe("exact");
  });

  it("returns an empty result without throwing on no claims", () => {
    expect(filterClaims(answer, []).claims).toEqual([]);
  });
});

describe("isRefusal", () => {
  it("recognises an answer that is entirely hedging", () => {
    // This is the INVISIBLE regime — the model does not know the company.
    // Scoring it as drift would put an unknown company below the neutral
    // line and collapse the two regimes the product exists to separate.
    expect(
      isRefusal(
        "I am not sure what that product is. I cannot provide specific pricing. " +
          "Please check their website.",
      ),
    ).toBe(true);
  });

  it("does not treat a confident answer as a refusal", () => {
    expect(
      isRefusal(
        "The Pro plan costs $49 per month. It includes 10,000 API calls. " +
          "Annual billing saves 20%.",
      ),
    ).toBe(false);
  });

  it("tolerates one hedge inside an otherwise substantive answer", () => {
    expect(
      isRefusal(
        "The Pro plan costs $49 per month. It includes 10,000 API calls. " +
          "I am not sure whether that includes overage.",
      ),
    ).toBe(false);
  });

  it("treats an empty answer as a refusal", () => {
    expect(isRefusal("")).toBe(true);
  });
});
