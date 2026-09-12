import { describe, expect, it } from "vitest";

import {
  MIN_PAGE_TEXT_CHARS,
  checkScanIntegrity,
  looksLikeConsentWall,
  summariseIntegrity,
  type IntegrityAnswer,
  type IntegrityInput,
} from "@/lib/pipeline/integrity";

const PANEL = ["gemini-3.8-flash", "qwen/qwen3.8-27b"];

const GOOD_TEXT = `
Parity Pro costs $49 per month and includes 10,000 API calls. The Starter plan
is free for up to 500 calls. Enterprise pricing is available on request and
includes SSO, audit logs, and a 99.9% uptime SLA. All plans include unlimited
seats. Annual billing saves 20%. Overage is billed at $0.004 per call. Support
response times are one business day on Pro and four hours on Enterprise.
`.repeat(4);

function answer(over: Partial<IntegrityAnswer> = {}): IntegrityAnswer {
  return {
    questionId: "q1",
    model: PANEL[0],
    condition: "MEMORY",
    claimCount: 3,
    retrievalCount: 4,
    error: null,
    rawText: "The Pro plan costs $49 per month.",
    ...over,
  };
}

/** A structurally complete scan: one question, both models, both conditions. */
function healthyInput(): IntegrityInput {
  const answers: IntegrityAnswer[] = [];
  for (const model of PANEL) {
    for (const condition of ["MEMORY", "BROWSING"] as const) {
      answers.push(answer({ model, condition }));
    }
  }
  return {
    pages: [{ url: "https://example.com/pricing", status: "OK", extractedText: GOOD_TEXT }],
    questions: [{ id: "q1", text: "How much does the Pro plan cost?" }],
    panelModels: PANEL,
    answers,
    browsingEnabled: true,
  };
}

describe("checkScanIntegrity — healthy baseline", () => {
  it("passes a structurally complete scan", () => {
    const report = checkScanIntegrity(healthyInput());
    expect(report.ok).toBe(true);
    expect(report.violations).toEqual([]);
  });
});

describe("page text below the minimum length", () => {
  it("flags a page that yielded almost nothing", () => {
    const input = healthyInput();
    const report = checkScanIntegrity({
      ...input,
      pages: [{ url: "https://example.com/", status: "OK", extractedText: "Welcome." }],
    });

    expect(report.ok).toBe(false);
    expect(report.violations[0].code).toBe("PAGE_TEXT_TOO_SHORT");
    expect(report.violations[0].subject).toBe("https://example.com/");
  });

  it("treats null extracted text as empty rather than crashing", () => {
    const input = healthyInput();
    const report = checkScanIntegrity({
      ...input,
      pages: [{ url: "https://example.com/", status: "OK", extractedText: null }],
    });
    expect(report.violations[0].code).toBe("PAGE_TEXT_TOO_SHORT");
  });

  it("accepts a page exactly at the minimum", () => {
    const input = healthyInput();
    const report = checkScanIntegrity({
      ...input,
      pages: [
        {
          url: "https://example.com/",
          status: "OK",
          extractedText: "a".repeat(MIN_PAGE_TEXT_CHARS),
        },
      ],
    });
    expect(report.ok).toBe(true);
  });

  it("ignores pages that already failed for an honest reason", () => {
    // A 403 is reported as a 403 elsewhere; it is not an integrity defect.
    const input = healthyInput();
    const report = checkScanIntegrity({
      ...input,
      pages: [
        { url: "https://example.com/a", status: "HTTP_ERROR", extractedText: null },
        { url: "https://example.com/b", status: "BLOCKED_BY_ROBOTS", extractedText: null },
        { url: "https://example.com/pricing", status: "OK", extractedText: GOOD_TEXT },
      ],
    });
    expect(report.ok).toBe(true);
  });
});

describe("consent and JavaScript walls", () => {
  it("detects a cookie interstitial", () => {
    const wall =
      "We use cookies to improve your experience. Accept all cookies or manage " +
      "preferences. Read our cookie policy for details about necessary cookies " +
      "and how we handle your privacy preferences on this website. " +
      "You can change your privacy preferences at any time. Reject all " +
      "non-essential cookies, or accept cookies to continue browsing. " +
      "Your privacy choices are stored for twelve months.";
    expect(looksLikeConsentWall(wall)).toBe(true);

    const input = healthyInput();
    const report = checkScanIntegrity({
      ...input,
      pages: [{ url: "https://example.com/", status: "OK", extractedText: wall }],
    });
    expect(report.violations.some((v) => v.code === "PAGE_LOOKS_LIKE_CONSENT_WALL")).toBe(
      true,
    );
  });

  it("no longer treats a JavaScript shell as an integrity failure", () => {
    // Client rendering is the site's visibility problem, reported as an
    // insight rather than as our inability to read the page.
    const shell = `${"You need to enable JavaScript to run this app. "}${"padding ".repeat(60)}`;
    const input = healthyInput();
    const report = checkScanIntegrity({
      ...input,
      pages: [{ url: "https://example.com/", status: "OK", extractedText: shell }],
    });
    expect(report.violations.some((v) => v.code.includes("JS_SHELL"))).toBe(false);
  });

  it("does NOT flag a long article that merely mentions cookies once", () => {
    // The length guard is what keeps this heuristic from firing on real
    // content — a privacy policy is a legitimate page to extract facts from.
    const article = `Our cookie policy is described below. ${GOOD_TEXT}`;
    expect(article.length).toBeGreaterThan(1_200);
    expect(looksLikeConsentWall(article)).toBe(false);
  });

  it("flags a short page with a single cookie marker", () => {
    const short = `This site uses cookies. ${"filler words here ".repeat(15)}`;
    expect(short.length).toBeLessThan(1_200);
    expect(looksLikeConsentWall(short)).toBe(true);
  });

  it("reports one violation per page, not three", () => {
    const input = healthyInput();
    const report = checkScanIntegrity({
      ...input,
      pages: [{ url: "https://example.com/", status: "OK", extractedText: "cookies" }],
    });
    const pageViolations = report.violations.filter((v) =>
      v.code.startsWith("PAGE_"),
    );
    expect(pageViolations).toHaveLength(1);
  });
});

describe("browsing condition with zero search results", () => {
  it("flags a browsing answer that retrieved nothing", () => {
    // Browsing with no sources is just the memory condition wearing a label,
    // which voids the entire memory-vs-browsing diagnostic.
    const input = healthyInput();
    const report = checkScanIntegrity({
      ...input,
      answers: input.answers.map((a) =>
        a.condition === "BROWSING" && a.model === PANEL[0]
          ? { ...a, retrievalCount: 0 }
          : a,
      ),
    });

    expect(report.ok).toBe(false);
    expect(report.violations.some((v) => v.code === "QUESTION_NO_SEARCH_RESULTS")).toBe(
      true,
    );
  });

  it("does not flag zero retrieval on the memory condition", () => {
    const input = healthyInput();
    const report = checkScanIntegrity({
      ...input,
      answers: input.answers.map((a) =>
        a.condition === "MEMORY" ? { ...a, retrievalCount: 0 } : a,
      ),
    });
    expect(report.ok).toBe(true);
  });

  it("does not require browsing answers when browsing was disabled", () => {
    const input = healthyInput();
    const report = checkScanIntegrity({
      ...input,
      browsingEnabled: false,
      answers: input.answers.filter((a) => a.condition === "MEMORY"),
    });
    expect(report.ok).toBe(true);
  });
});

describe("missing answers from a panel member", () => {
  it("flags a question with no answer row at all", () => {
    const input = healthyInput();
    const report = checkScanIntegrity({
      ...input,
      answers: input.answers.filter((a) => a.model !== PANEL[1]),
    });

    const missing = report.violations.filter(
      (v) => v.code === "QUESTION_MISSING_ANSWER",
    );
    // Both conditions for the absent model.
    expect(missing).toHaveLength(2);
    expect(missing[0].subject).toContain(PANEL[1]);
  });

  it("flags an answer row that exists but errored", () => {
    // Present-but-failed still means the question has no answer from that
    // member, so the score denominator is wrong.
    const input = healthyInput();
    const report = checkScanIntegrity({
      ...input,
      answers: input.answers.map((a) =>
        a.model === PANEL[0] && a.condition === "MEMORY"
          ? { ...a, error: "429 rate limited", rawText: null }
          : a,
      ),
    });

    const missing = report.violations.filter(
      (v) => v.code === "QUESTION_MISSING_ANSWER",
    );
    expect(missing).toHaveLength(1);
    expect(missing[0].message).toContain("429 rate limited");
  });

  it("flags an answer that returned only whitespace", () => {
    const input = healthyInput();
    const report = checkScanIntegrity({
      ...input,
      answers: input.answers.map((a) =>
        a.condition === "BROWSING" && a.model === PANEL[1]
          ? { ...a, rawText: "   \n  " }
          : a,
      ),
    });
    expect(
      report.violations.some((v) => v.code === "QUESTION_MISSING_ANSWER"),
    ).toBe(true);
  });

  it("does not also report no-claims for an answer already missing", () => {
    const input = healthyInput();
    const report = checkScanIntegrity({
      ...input,
      answers: input.answers.map((a) =>
        a.model === PANEL[0] && a.condition === "MEMORY"
          ? { ...a, error: "boom", rawText: null, claimCount: 0 }
          : a,
      ),
    });
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].code).toBe("QUESTION_MISSING_ANSWER");
  });
});

describe("answers that produced no claims", () => {
  it("flags an answer decomposed into zero claims", () => {
    const input = healthyInput();
    const report = checkScanIntegrity({
      ...input,
      answers: input.answers.map((a) =>
        a.model === PANEL[1] && a.condition === "MEMORY"
          ? { ...a, claimCount: 0 }
          : a,
      ),
    });

    expect(report.ok).toBe(false);
    const noClaims = report.violations.filter((v) => v.code === "ANSWER_NO_CLAIMS");
    expect(noClaims).toHaveLength(1);
    expect(noClaims[0].message).toContain("contributed nothing to the score");
  });
});

describe("reporting", () => {
  it("returns every violation, not just the first", () => {
    const report = checkScanIntegrity({
      pages: [{ url: "https://example.com/", status: "OK", extractedText: "short" }],
      questions: [{ id: "q1", text: "How much?" }],
      panelModels: PANEL,
      answers: [],
      browsingEnabled: true,
    });

    // 1 page + (2 models × 2 conditions) missing answers.
    expect(report.violations).toHaveLength(5);
  });

  it("summarises without claiming a score", () => {
    const report = checkScanIntegrity({
      pages: [],
      questions: [{ id: "q1", text: "How much?" }],
      panelModels: [PANEL[0]],
      answers: [],
      browsingEnabled: false,
    });
    const summary = summariseIntegrity(report.violations);
    expect(summary).toContain("structurally incomplete");
    expect(summary).toContain("No Parity Score");
  });

  it("says so plainly when everything passed", () => {
    expect(summariseIntegrity([])).toContain("passed");
  });
});
