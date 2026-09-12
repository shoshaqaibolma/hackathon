import { generateObject, generateText, type LanguageModel } from "ai";
import type { z } from "zod";

import { CAPS } from "@/lib/config";
import { cacheKey, readCache, writeCache } from "@/lib/llm/cache";
import {
  languageModel,
  type ByokCredential,
  type ModelRef,
} from "@/lib/llm/models";
import {
  estimateTokens,
  getLimiter,
  type ThrottleNotice,
} from "@/lib/llm/ratelimit";
import { scrubError } from "@/lib/llm/scrub";

/**
 * The single path every model call takes.
 *
 * Responsibilities, in order: cache lookup, rate-limit pacing, the call,
 * truncation guard, cache write, usage accounting. Nothing in the pipeline
 * may call generateObject/generateText directly — doing so would bypass the
 * cache (costing money twice) and the limiter (earning 429s mid-scan).
 */

export class ModelCallError extends Error {
  constructor(
    message: string,
    public readonly stage: string,
    public readonly model: string,
  ) {
    super(message);
    this.name = "ModelCallError";
  }
}

export type CallContext = {
  stage: string;
  credential?: ByokCredential | null;
  /**
   * Panel answers on a re-run must NOT be served from cache, or the
   * before/after score cannot move and the closed loop would look like it
   * works while being inert.
   */
  bypassCache?: boolean;
  /** Called when the limiter made us wait, so the UI can show throttling. */
  onThrottle?: (notice: ThrottleNotice) => void;
};

export type CallRecord = {
  stage: string;
  provider: ModelRef["provider"];
  model: string;
  cached: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  throttledMs: number;
};

export type CallResult<T> = {
  value: T;
  record: CallRecord;
};

/**
 * Free tiers return transient failures that are not our fault and not
 * permanent: provider-side overload, and 429s when another process shares
 * the quota. The limiter prevents most of these; this catches the rest
 * rather than failing a whole scan on a blip.
 */
function isTransient(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /429|rate.?limit|quota|high demand|overload|503|502|timeout|ECONNRESET/i.test(
    message,
  );
}

/** Honour a provider's "Please retry in 16.2s" hint when it gives one. */
function retryHintMs(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/retry in ([\d.]+)\s*s/i);
  if (!match) return null;
  const seconds = Number.parseFloat(match[1]);
  return Number.isFinite(seconds) ? Math.ceil(seconds * 1000) + 500 : null;
}

/** Providers name the real ceiling in their 429 text: "limit: 20, model: ...". */
function observedLimit(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/limit:\s*(\d+)/i);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

const MAX_TRANSIENT_RETRIES = 3;

async function withRetry<T>(
  fn: () => Promise<T>,
  onWait?: (ms: number) => void,
  onObservedLimit?: (limit: number) => void,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const limit = observedLimit(error);
      if (limit !== null) onObservedLimit?.(limit);

      if (!isTransient(error) || attempt === MAX_TRANSIENT_RETRIES) break;

      const wait = retryHintMs(error) ?? Math.min(30_000, 2_000 * 2 ** attempt);
      onWait?.(wait);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }

  throw lastError;
}

function resolveModel(ref: ModelRef, credential: ByokCredential | null): LanguageModel {
  return languageModel(ref, credential);
}

/**
 * Guard against the silent-truncation trap.
 *
 * Gemini always thinks and can burn the entire output budget on reasoning,
 * returning a fragment with finishReason "length" and no error. A truncated
 * answer looks exactly like a real one downstream, so it is rejected here.
 */
function assertComplete(finishReason: string, stage: string, model: string): void {
  if (finishReason === "length") {
    throw new ModelCallError(
      `Response was truncated (finishReason: length). Raise maxOutputTokens above ${CAPS.MIN_OUTPUT_TOKENS}.`,
      stage,
      model,
    );
  }
}

/** Structured call. The schema name is part of the cache key. */
export async function callObject<T>(
  ref: ModelRef,
  schema: z.ZodType<T>,
  schemaName: string,
  system: string,
  prompt: string,
  context: CallContext,
  maxOutputTokens: number = CAPS.MIN_OUTPUT_TOKENS,
): Promise<CallResult<T>> {
  const credential = context.credential ?? null;
  const key = cacheKey({ model: ref.modelId, schemaName, system, prompt });

  if (!context.bypassCache) {
    const hit = await readCache(key).catch(() => null);
    if (hit) {
      const parsed = schema.safeParse(JSON.parse(hit.response));
      if (parsed.success) {
        return {
          value: parsed.data,
          record: {
            stage: context.stage,
            provider: ref.provider,
            model: ref.modelId,
            cached: true,
            inputTokens: hit.inputTokens,
            outputTokens: hit.outputTokens,
            latencyMs: 0,
            throttledMs: 0,
          },
        };
      }
      // A cached row that no longer matches the schema is stale, not fatal.
    }
  }

  const limiter = getLimiter(ref.provider);
  const estimate = estimateTokens(system + prompt, maxOutputTokens);
  const notice = await limiter.acquire(estimate);
  if (notice) context.onThrottle?.(notice);

  const started = Date.now();
  try {
    const result = await withRetry(
      () =>
        generateObject({
          model: resolveModel(ref, credential),
          schema,
          system,
          prompt,
          maxOutputTokens,
        }),
      (ms) =>
        context.onThrottle?.({ provider: ref.provider, reason: "rpm", waitMs: ms }),
      (limit) => limiter.observeLimit(limit),
    );

    assertComplete(result.finishReason, context.stage, ref.modelId);
    limiter.settle(estimate, result.usage.totalTokens);

    await writeCache(key, { model: ref.modelId, schemaName, system, prompt }, {
      response: JSON.stringify(result.object),
      inputTokens: result.usage.inputTokens ?? null,
      outputTokens: result.usage.outputTokens ?? null,
    }).catch(() => undefined);

    return {
      value: result.object,
      record: {
        stage: context.stage,
        provider: ref.provider,
        model: ref.modelId,
        cached: false,
        inputTokens: result.usage.inputTokens ?? null,
        outputTokens: result.usage.outputTokens ?? null,
        latencyMs: Date.now() - started,
        throttledMs: notice?.waitMs ?? 0,
      },
    };
  } catch (error) {
    if (error instanceof ModelCallError) throw error;
    throw new ModelCallError(
      scrubError(error, credential ? [credential.apiKey] : []),
      context.stage,
      ref.modelId,
    );
  }
}

/** Prose call. Used for panel answers, which must be free text. */
export async function callText(
  ref: ModelRef,
  system: string,
  prompt: string,
  context: CallContext,
  maxOutputTokens: number = CAPS.ANSWER_OUTPUT_TOKENS,
): Promise<CallResult<string>> {
  const credential = context.credential ?? null;
  const key = cacheKey({ model: ref.modelId, schemaName: "text", system, prompt });

  if (!context.bypassCache) {
    const hit = await readCache(key).catch(() => null);
    if (hit) {
      return {
        value: hit.response,
        record: {
          stage: context.stage,
          provider: ref.provider,
          model: ref.modelId,
          cached: true,
          inputTokens: hit.inputTokens,
          outputTokens: hit.outputTokens,
          latencyMs: 0,
          throttledMs: 0,
        },
      };
    }
  }

  const limiter = getLimiter(ref.provider);
  const estimate = estimateTokens(system + prompt, maxOutputTokens);
  const notice = await limiter.acquire(estimate);
  if (notice) context.onThrottle?.(notice);

  const started = Date.now();
  try {
    const result = await withRetry(
      () =>
        generateText({
          model: resolveModel(ref, credential),
          system,
          prompt,
          maxOutputTokens,
        }),
      (ms) =>
        context.onThrottle?.({ provider: ref.provider, reason: "rpm", waitMs: ms }),
      (limit) => limiter.observeLimit(limit),
    );

    assertComplete(result.finishReason, context.stage, ref.modelId);
    limiter.settle(estimate, result.usage.totalTokens);

    if (!result.text.trim()) {
      throw new ModelCallError("Model returned empty text.", context.stage, ref.modelId);
    }

    await writeCache(key, { model: ref.modelId, schemaName: "text", system, prompt }, {
      response: result.text,
      inputTokens: result.usage.inputTokens ?? null,
      outputTokens: result.usage.outputTokens ?? null,
    }).catch(() => undefined);

    return {
      value: result.text,
      record: {
        stage: context.stage,
        provider: ref.provider,
        model: ref.modelId,
        cached: false,
        inputTokens: result.usage.inputTokens ?? null,
        outputTokens: result.usage.outputTokens ?? null,
        latencyMs: Date.now() - started,
        throttledMs: notice?.waitMs ?? 0,
      },
    };
  } catch (error) {
    if (error instanceof ModelCallError) throw error;
    throw new ModelCallError(
      scrubError(error, credential ? [credential.apiKey] : []),
      context.stage,
      ref.modelId,
    );
  }
}
