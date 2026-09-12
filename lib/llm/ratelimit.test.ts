import { describe, expect, it } from "vitest";

import {
  DailyQuotaExhaustedError,
  ProviderLimiter,
  estimateTokens,
  type LimiterConfig,
} from "@/lib/llm/ratelimit";

/**
 * Virtual clock: the sleeper advances time rather than waiting, so the
 * pacing logic is tested deterministically and instantly.
 */
function harness(config: LimiterConfig) {
  let now = 0;
  const limiter = new ProviderLimiter(
    "GROQ",
    config,
    () => now,
    async (ms) => {
      now += ms;
    },
  );
  return {
    limiter,
    elapsed: () => now,
  };
}

const GROQ_LIKE: LimiterConfig = { rpm: 30, tpm: 6_000, rpd: 1_000 };

describe("ProviderLimiter", () => {
  it("does not delay a call that fits in the budget", async () => {
    const { limiter, elapsed } = harness(GROQ_LIKE);
    const notice = await limiter.acquire(100);
    expect(notice).toBeNull();
    expect(elapsed()).toBe(0);
  });

  it("throttles on tokens per minute and says so", async () => {
    const { limiter } = harness(GROQ_LIKE);

    // Spend the whole 6,000-token minute.
    await limiter.acquire(6_000);
    const notice = await limiter.acquire(1_000);

    expect(notice).not.toBeNull();
    expect(notice?.reason).toBe("tpm");
    expect(notice?.waitMs).toBeGreaterThan(0);
    expect(notice?.provider).toBe("GROQ");
  });

  it("throttles on requests per minute when tokens are cheap", async () => {
    const { limiter } = harness({ rpm: 2, tpm: 1_000_000, rpd: 1_000 });

    await limiter.acquire(1);
    await limiter.acquire(1);
    const notice = await limiter.acquire(1);

    expect(notice?.reason).toBe("rpm");
  });

  it("refills over time", async () => {
    const { limiter } = harness(GROQ_LIKE);

    await limiter.acquire(6_000);
    // Waiting the full minute back should clear the debt.
    const first = await limiter.acquire(6_000);
    expect(first?.waitMs).toBeGreaterThanOrEqual(59_000);

    const second = await limiter.acquire(10);
    // Some capacity has regenerated during the previous wait.
    expect(second?.waitMs ?? 0).toBeLessThan(first!.waitMs);
  });

  it("clamps an oversized request instead of hanging forever", async () => {
    const { limiter } = harness(GROQ_LIKE);

    // 20,000 tokens can never fit in a 6,000-token bucket. It must become
    // the only call that minute, not deadlock the scan.
    const notice = await limiter.acquire(20_000);
    expect(notice).toBeNull();

    const next = await limiter.acquire(100);
    expect(next?.reason).toBe("tpm");
  });

  it("throws a real error when the daily quota is gone", async () => {
    const { limiter } = harness({ rpm: 1_000, tpm: 1_000_000, rpd: 2 });

    await limiter.acquire(1);
    await limiter.acquire(1);

    await expect(limiter.acquire(1)).rejects.toBeInstanceOf(
      DailyQuotaExhaustedError,
    );
    expect(limiter.remainingDaily).toBe(0);
  });

  it("keeps working after a rejected acquisition", async () => {
    // A rejection must not poison the internal queue for later callers.
    const { limiter } = harness({ rpm: 1_000, tpm: 1_000_000, rpd: 1 });

    await limiter.acquire(1);
    await expect(limiter.acquire(1)).rejects.toBeInstanceOf(
      DailyQuotaExhaustedError,
    );
    await expect(limiter.acquire(1)).rejects.toBeInstanceOf(
      DailyQuotaExhaustedError,
    );
  });

  it("serialises concurrent acquisitions so they cannot double-spend", async () => {
    const { limiter } = harness({ rpm: 2, tpm: 1_000_000, rpd: 100 });

    const notices = await Promise.all([
      limiter.acquire(1),
      limiter.acquire(1),
      limiter.acquire(1),
    ]);

    // Exactly one of the three had to wait for the 2-per-minute budget.
    expect(notices.filter((n) => n !== null)).toHaveLength(1);
  });

  it("charges a deficit when actual usage exceeds the estimate", async () => {
    const { limiter } = harness(GROQ_LIKE);

    await limiter.acquire(100);
    limiter.settle(100, 5_900);

    const notice = await limiter.acquire(500);
    expect(notice?.reason).toBe("tpm");
  });

  it("ignores an unknown actual usage", async () => {
    const { limiter } = harness(GROQ_LIKE);
    await limiter.acquire(100);
    expect(() => limiter.settle(100, undefined)).not.toThrow();
  });
});

describe("estimateTokens", () => {
  it("grows with input length and includes output headroom", () => {
    expect(estimateTokens("", 0)).toBeGreaterThanOrEqual(0);
    expect(estimateTokens("a".repeat(3_500), 0)).toBeGreaterThan(900);
    expect(estimateTokens("hello", 512)).toBeGreaterThan(512);
  });
});
