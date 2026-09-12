import { describe, expect, it } from "vitest";

import {
  DENSITY_THRESHOLD,
  deriveInsights,
  hasJsShellMarker,
  textDensity,
  type PageSample,
} from "@/lib/pipeline/insights";

function page(over: Partial<PageSample> = {}): PageSample {
  return {
    url: "https://example.com/pricing",
    htmlBytes: 40_000,
    textChars: 4_000,
    text: "The Pro plan costs $49 per month and includes 10,000 API calls.",
    status: "OK",
    ...over,
  };
}

describe("textDensity", () => {
  it("is the text share of the payload", () => {
    expect(textDensity(100_000, 2_000)).toBeCloseTo(0.02);
  });

  it("returns zero rather than dividing by zero", () => {
    expect(textDensity(0, 500)).toBe(0);
  });
});

describe("hasJsShellMarker", () => {
  it("detects the standard app-shell fallbacks", () => {
    expect(hasJsShellMarker("You need to enable JavaScript to run this app.")).toBe(true);
    expect(hasJsShellMarker("JavaScript is required to view this page")).toBe(true);
  });

  it("does not fire on prose that merely mentions JavaScript", () => {
    expect(
      hasJsShellMarker("Our SDK supports JavaScript, Python, and Go."),
    ).toBe(false);
  });
});

describe("deriveInsights — client rendering", () => {
  it("flags the github.com/pricing shape", () => {
    // ~187 KB of HTML extracting to ~2,100 characters. Passes a naive length
    // check and is still substantially invisible.
    const insights = deriveInsights([
      page({ htmlBytes: 187_000, textChars: 2_116 }),
    ]);

    expect(insights).toHaveLength(1);
    expect(insights[0].code).toBe("CLIENT_RENDERED");
    expect(insights[0].evidence.htmlBytes).toBe(187_000);
    expect(insights[0].detail).toContain("2,116");
  });

  it("writes the finding for the site owner, not about our crawler", () => {
    const [insight] = deriveInsights([page({ htmlBytes: 187_000, textChars: 2_116 })]);
    expect(insight.headline).toMatch(/invisible to AI crawlers/i);
    // Never phrased as our failure.
    expect(insight.headline).not.toMatch(/could not|unable|failed/i);
  });

  it("flags an explicit JavaScript-required shell regardless of size", () => {
    const insights = deriveInsights([
      page({
        htmlBytes: 5_000,
        textChars: 60,
        text: "You need to enable JavaScript to run this app.",
      }),
    ]);
    expect(insights[0].code).toBe("CLIENT_RENDERED");
  });

  it("does NOT flag a normal server-rendered page", () => {
    expect(deriveInsights([page({ htmlBytes: 120_000, textChars: 11_306 })])).toEqual(
      [],
    );
  });

  it("does not flag a small page merely for being small", () => {
    // Density is meaningless on a tiny payload; that is thin content, not
    // hidden content, and the two need different advice.
    const insights = deriveInsights([page({ htmlBytes: 6_000, textChars: 120 })]);
    expect(insights[0].code).toBe("THIN_CONTENT");
  });

  it("sits exactly on the documented threshold", () => {
    const justUnder = deriveInsights([
      page({ htmlBytes: 100_000, textChars: Math.floor(100_000 * DENSITY_THRESHOLD) - 1 }),
    ]);
    const justOver = deriveInsights([
      page({ htmlBytes: 100_000, textChars: Math.ceil(100_000 * DENSITY_THRESHOLD) + 1 }),
    ]);
    expect(justUnder[0]?.code).toBe("CLIENT_RENDERED");
    expect(justOver).toEqual([]);
  });
});

describe("deriveInsights — robots", () => {
  it("reports a blocked page as a reachability finding", () => {
    const insights = deriveInsights([page({ status: "BLOCKED_BY_ROBOTS" })]);
    expect(insights[0].code).toBe("BLOCKED_BY_ROBOTS");
    expect(insights[0].detail).toMatch(/cannot reach them/i);
  });

  it("ignores pages that failed for unrelated reasons", () => {
    expect(deriveInsights([page({ status: "HTTP_ERROR" })])).toEqual([]);
  });
});
