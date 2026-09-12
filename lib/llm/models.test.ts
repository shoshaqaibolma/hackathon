import { describe, expect, it } from "vitest";

import { BYOK_DEFAULT, FREE_PANEL, panelFor } from "@/lib/llm/models";

/**
 * Panel ORDER is a product decision, not an implementation detail.
 *
 * Gemini leads because it is the credibility anchor: a frontier-lab model
 * getting a company's pricing wrong is persuasive, while a small open model
 * getting it wrong invites "well, of course it did". The same ordering
 * governs how results are summarised in copy, and which single model FREE
 * mode falls back to when it is capped to one.
 */
describe("panel ordering", () => {
  it("leads with the Google model", () => {
    expect(FREE_PANEL[0].provider).toBe("GOOGLE");
    expect(FREE_PANEL[0].label).toMatch(/gemini/i);
  });

  it("places the Groq model second", () => {
    expect(FREE_PANEL[1].provider).toBe("GROQ");
  });

  it("uses two distinct providers so agreement means something", () => {
    const providers = new Set(FREE_PANEL.map((m) => m.provider));
    expect(providers.size).toBe(FREE_PANEL.length);
  });

  it("falls back to Gemini, not Qwen, when capped to one model", () => {
    // FREE mode allows a single model. It must be the credibility anchor.
    const panel = panelFor(null, 1);
    expect(panel).toHaveLength(1);
    expect(panel[0].provider).toBe("GOOGLE");
  });

  it("preserves order when the cap exceeds the panel size", () => {
    expect(panelFor(null, 10).map((m) => m.provider)).toEqual(["GOOGLE", "GROQ"]);
  });

  it("never returns an empty panel even at a zero cap", () => {
    expect(panelFor(null, 0)).toHaveLength(1);
  });
});

describe("BYOK panel", () => {
  it("uses only the user's own provider, never the operator's free tier", () => {
    for (const provider of ["ANTHROPIC", "OPENAI", "GOOGLE", "GROQ"] as const) {
      const panel = panelFor({ provider, apiKey: "x" }, 5);
      expect(panel).toHaveLength(1);
      expect(panel[0].provider).toBe(provider);
    }
  });

  it("has a default model for every provider", () => {
    for (const provider of ["ANTHROPIC", "OPENAI", "GOOGLE", "GROQ"] as const) {
      expect(BYOK_DEFAULT[provider].modelId).toBeTruthy();
      expect(BYOK_DEFAULT[provider].provider).toBe(provider);
    }
  });
});
