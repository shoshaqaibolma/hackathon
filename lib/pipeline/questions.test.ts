import { describe, expect, it } from "vitest";

import {
  brandTokens,
  displayName,
  filterQuestions,
  mentionsBrand,
  repairQuestion,
} from "@/lib/pipeline/questions";

/**
 * Regression from the first screening run, where questions across all eleven
 * domains omitted the company name and the panel answered "which service do
 * you mean?" — scored as fabrication.
 */

describe("brandTokens", () => {
  it("strips the TLD and www", () => {
    expect(brandTokens("planetscale.com")).toContain("planetscale");
    expect(brandTokens("www.dropbox.com")).toContain("dropbox");
    expect(brandTokens("fly.io")).toContain("fly");
    expect(brandTokens("notion.so")).toContain("notion");
    expect(brandTokens("railway.app")).toContain("railway");
  });

  it("uses the most specific label of a subdomain", () => {
    expect(brandTokens("docs.tavily.com")).toContain("tavily");
  });

  it("matches hyphenated names with and without the hyphen", () => {
    const tokens = brandTokens("my-company.com");
    expect(tokens).toContain("my-company");
    expect(tokens).toContain("mycompany");
  });

  it("tolerates a full URL", () => {
    expect(brandTokens("https://www.github.com/pricing")).toContain("github");
  });
});

describe("mentionsBrand", () => {
  it("accepts a question naming the company", () => {
    expect(
      mentionsBrand("Does Notion's free plan include version history?", "notion.so"),
    ).toBe(true);
  });

  it("is case and punctuation insensitive", () => {
    expect(mentionsBrand("what does HEROKU cost?", "heroku.com")).toBe(true);
    expect(mentionsBrand("Is fly.io free?", "fly.io")).toBe(true);
  });

  it("rejects the exact failure seen in the wild", () => {
    // No subject at all — the panel cannot answer this, and its refusal was
    // being scored as a fabrication.
    expect(
      mentionsBrand(
        "How far back can I recover previous versions of my document on the free plan?",
        "notion.so",
      ),
    ).toBe(false);
  });

  it("rejects a question about a different company", () => {
    expect(mentionsBrand("How much does Dropbox cost?", "notion.so")).toBe(false);
  });
});

describe("filterQuestions", () => {
  const domain = "heroku.com";

  it("keeps named questions and repairs unnamed ones", () => {
    const result = filterQuestions(
      [
        "Does Heroku still offer a free dyno tier?",
        "What is the cheapest plan available?",
        "How much does Heroku Postgres cost per month?",
      ],
      domain,
    );

    expect(result.questions).toHaveLength(3);
    expect(result.repaired).toBe(1);
    expect(result.dropped).toBe(0);
    expect(result.questions[1]).toBe(
      "In Heroku, what is the cheapest plan available?",
    );
  });

  it("deduplicates", () => {
    const result = filterQuestions(
      ["Does Heroku have a free tier?", "does heroku have a free tier?"],
      domain,
    );
    expect(result.questions).toHaveLength(1);
  });

  it("drops only what cannot be repaired grammatically", () => {
    const result = filterQuestions(["Tell me about the free plan."], domain);
    expect(result.questions).toEqual([]);
    expect(result.dropped).toBe(1);
    expect(result.droppedReasons[0]).toContain("cannot be repaired");
  });
});

describe("repairQuestion", () => {
  it("leaves an already-named question untouched", () => {
    const q = "Does Heroku have a free tier?";
    expect(repairQuestion(q, "heroku.com")).toBe(q);
  });

  it("produces a question a real customer would ask", () => {
    // The exact failure from the wild, repaired.
    expect(
      repairQuestion(
        "How far back can I recover previous versions of my document on the free plan?",
        "notion.so",
      ),
    ).toBe(
      "In Notion, how far back can I recover previous versions of my document on the free plan?",
    );
  });

  it("handles every common question opener", () => {
    for (const opener of ["What", "How", "Are", "Is", "Can", "Does", "Which"]) {
      const repaired = repairQuestion(`${opener} the plan free?`, "fly.io");
      expect(repaired, opener).toContain("In Fly,");
      expect(repaired, opener).toContain(opener.toLowerCase());
    }
  });

  it("refuses a non-question it cannot prefix grammatically", () => {
    expect(repairQuestion("Tell me the price.", "fly.io")).toBeNull();
  });
});

describe("displayName", () => {
  it("capitalises the brand for use in prompts", () => {
    expect(displayName("heroku.com")).toBe("Heroku");
    expect(displayName("fly.io")).toBe("Fly");
  });
});
