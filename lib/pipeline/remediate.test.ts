import { describe, expect, it } from "vitest";

import { validatePatch } from "@/lib/pipeline/remediate";
import type { LedgerFact } from "@/lib/pipeline/adjudicate";

const fact: LedgerFact = {
  id: "f1",
  statement: "The Pro plan includes 10,000 API calls per month for $49.",
  category: "PRICING",
  evidenceSpan: "Pro — $49/mo — 10,000 API calls per month",
  sourceUrl: "https://example.com/pricing",
};

/**
 * A patch that invents a number would make Parity do exactly what it flags
 * models for. The prompt forbids it; this enforces it.
 */
describe("validatePatch", () => {
  it("accepts a patch built from the fact's own numbers", () => {
    const patch = "## Pricing\nPro — $49/mo — 10,000 API calls per month.";
    expect(validatePatch(patch, fact).ok).toBe(true);
  });

  it("accepts a patch with no numbers at all", () => {
    expect(validatePatch("## Pricing\nSee the pricing page.", fact).ok).toBe(true);
  });

  it("REJECTS a patch that invents a price", () => {
    const result = validatePatch("Pro — $29/mo — 10,000 API calls", fact);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("29");
  });

  it("REJECTS a patch that invents a limit", () => {
    expect(validatePatch("Pro includes 25,000 API calls", fact).ok).toBe(false);
  });

  it("rejects an empty patch", () => {
    expect(validatePatch("   ", fact).ok).toBe(false);
  });

  it("tolerates single digits used structurally", () => {
    // JSON-LD and markdown both emit stray small integers in scaffolding.
    const patch = '{"@type":"Offer","price":"49","priceCurrency":"USD"}';
    expect(validatePatch(patch, fact).ok).toBe(true);
  });

  it("allows numbers that appear only in the source URL", () => {
    const urlFact = { ...fact, sourceUrl: "https://example.com/pricing/2026" };
    expect(validatePatch("See https://example.com/pricing/2026", urlFact).ok).toBe(true);
  });
});
