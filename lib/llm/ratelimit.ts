import type { ProviderId } from "@/lib/llm/models";

/**
 * Per-provider token-bucket limiter.
 *
 * Groq's free tier is roughly 30 requests/min, 6,000 tokens/min, 1,000
 * requests/day. That TPM ceiling is the binding constraint on a scan: a
 * single browsing answer with injected snippets can be 1,500+ tokens, so
 * naive fan-out gets 429s within seconds.
 *
 * We pace ourselves instead of discovering the limit the hard way. Waiting
 * is reported to the caller so the scan UI can show throttling as a real
 * state rather than an unexplained pause.
 *
 * HONEST LIMITATION: these buckets are per process. On serverless, several
 * instances share one provider quota and could collectively exceed it. A
 * single scan runs inside one invocation, so within a scan the pacing is
 * accurate; across concurrent scans it is optimistic. Postgres-backed
 * buckets would fix it and are not worth the round-trip per call here.
 */

export type ThrottleReason = "rpm" | "tpm" | "rpd";

export type ThrottleNotice = {
  provider: ProviderId;
  reason: ThrottleReason;
  waitMs: number;
};

export class DailyQuotaExhaustedError extends Error {
  constructor(public readonly provider: ProviderId) {
    super(
      `${provider} free-tier daily request quota is exhausted. Try again tomorrow, or use your own key.`,
    );
    this.name = "DailyQuotaExhaustedError";
  }
}

export type LimiterConfig = {
  /** Requests per minute. */
  rpm: number;
  /** Tokens per minute. */
  tpm: number;
  /** Requests per day. */
  rpd: number;
};

/** Free-tier ceilings, kept slightly under the published numbers as headroom. */
export const PROVIDER_LIMITS: Record<ProviderId, LimiterConfig> = {
  // ~30 RPM / 6,000 TPM / 1,000 RPD published.
  GROQ: { rpm: 27, tpm: 5_400, rpd: 950 },
  // Google AI Studio free tier is far more generous on tokens.
  GOOGLE: { rpm: 14, tpm: 240_000, rpd: 1_400 },
  // BYOK providers: paced only enough to be polite; the user's own limits apply.
  ANTHROPIC: { rpm: 50, tpm: 200_000, rpd: 100_000 },
  OPENAI: { rpm: 50, tpm: 200_000, rpd: 100_000 },
};

type Bucket = {
  /** Current available units. */
  tokens: number;
  /** Units restored per millisecond. */
  refillRate: number;
  capacity: number;
  lastRefill: number;
};

function makeBucket(perMinute: number, now: number): Bucket {
  return {
    tokens: perMinute,
    capacity: perMinute,
    refillRate: perMinute / 60_000,
    lastRefill: now,
  };
}

function refill(bucket: Bucket, now: number): void {
  const elapsed = now - bucket.lastRefill;
  if (elapsed <= 0) return;
  bucket.tokens = Math.min(
    bucket.capacity,
    bucket.tokens + elapsed * bucket.refillRate,
  );
  bucket.lastRefill = now;
}

/** Milliseconds until `needed` units are available. 0 if available now. */
function waitFor(bucket: Bucket, needed: number, now: number): number {
  refill(bucket, now);
  if (bucket.tokens >= needed) return 0;
  return Math.ceil((needed - bucket.tokens) / bucket.refillRate);
}

export type Clock = () => number;
export type Sleeper = (ms: number) => Promise<void>;

export class ProviderLimiter {
  private readonly requests: Bucket;
  private readonly tokens: Bucket;
  private dailyCount = 0;
  private dailyWindowStart: number;
  /** Serialises acquisition so concurrent callers cannot double-spend. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    public readonly provider: ProviderId,
    private readonly config: LimiterConfig,
    private readonly now: Clock = Date.now,
    private readonly sleep: Sleeper = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    const t = now();
    this.requests = makeBucket(config.rpm, t);
    this.tokens = makeBucket(config.tpm, t);
    this.dailyWindowStart = t;
  }

  /**
   * Reserve capacity for one call. Resolves once the call may proceed,
   * returning how long it waited and why — surface that in the UI.
   *
   * A request larger than the whole per-minute token bucket would otherwise
   * wait forever, so it is clamped to the bucket capacity: it will be the
   * only call that minute, which is the correct degradation.
   */
  async acquire(estimatedTokens: number): Promise<ThrottleNotice | null> {
    const run = this.queue.then(() => this.acquireInternal(estimatedTokens));
    // Keep the chain alive even if one acquisition rejects.
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async acquireInternal(
    estimatedTokens: number,
  ): Promise<ThrottleNotice | null> {
    this.rolloverDay();

    if (this.dailyCount >= this.config.rpd) {
      throw new DailyQuotaExhaustedError(this.provider);
    }

    const needed = Math.max(1, Math.min(estimatedTokens, this.tokens.capacity));

    let totalWait = 0;
    let reason: ThrottleReason = "rpm";

    for (;;) {
      const now = this.now();
      const requestWait = waitFor(this.requests, 1, now);
      const tokenWait = waitFor(this.tokens, needed, now);
      const wait = Math.max(requestWait, tokenWait);

      if (wait <= 0) break;

      reason = tokenWait >= requestWait ? "tpm" : "rpm";
      totalWait += wait;
      await this.sleep(wait);
    }

    this.requests.tokens -= 1;
    this.tokens.tokens -= needed;
    this.dailyCount += 1;

    return totalWait > 0
      ? { provider: this.provider, reason, waitMs: totalWait }
      : null;
  }

  /**
   * Reconcile the estimate against actual usage once the call returns.
   * Under-estimating is the dangerous direction, so only deficits are charged.
   */
  settle(estimatedTokens: number, actualTokens: number | undefined): void {
    if (actualTokens === undefined) return;
    const clampedEstimate = Math.max(
      1,
      Math.min(estimatedTokens, this.tokens.capacity),
    );
    const deficit = actualTokens - clampedEstimate;
    if (deficit > 0) {
      this.tokens.tokens = Math.max(-this.tokens.capacity, this.tokens.tokens - deficit);
    }
  }

  private rolloverDay(): void {
    const now = this.now();
    if (now - this.dailyWindowStart >= 86_400_000) {
      this.dailyWindowStart = now;
      this.dailyCount = 0;
    }
  }

  get remainingDaily(): number {
    this.rolloverDay();
    return Math.max(0, this.config.rpd - this.dailyCount);
  }
}

const limiters = new Map<ProviderId, ProviderLimiter>();

export function getLimiter(provider: ProviderId): ProviderLimiter {
  let limiter = limiters.get(provider);
  if (!limiter) {
    limiter = new ProviderLimiter(provider, PROVIDER_LIMITS[provider]);
    limiters.set(provider, limiter);
  }
  return limiter;
}

/** Rough token estimate. Deliberately generous — under-estimating causes 429s. */
export function estimateTokens(text: string, expectedOutput = 512): number {
  return Math.ceil(text.length / 3.5) + expectedOutput;
}
