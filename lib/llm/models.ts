import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

/**
 * Provider registry and mode-aware model selection.
 *
 * The public deployment runs on free tiers, so no visitor can spend money
 * that isn't theirs. BYOK users run the entire pipeline — panel, adjudication
 * and remediation — on their own key, which is why their quota is never
 * mixed with the server's.
 */

export type ProviderId = "GOOGLE" | "GROQ" | "ANTHROPIC" | "OPENAI";

export type ModelRef = {
  provider: ProviderId;
  modelId: string;
  label: string;
};

/** A key supplied by the user for a single request. Never persisted. */
export type ByokCredential = {
  provider: ProviderId;
  apiKey: string;
};

export class MissingCredentialError extends Error {
  constructor(public readonly provider: ProviderId) {
    super(`No API key configured for ${provider}.`);
    this.name = "MissingCredentialError";
  }
}

// ---------------------------------------------------------------- models

/**
 * Model ids are env-overridable because free-tier catalogues move without
 * warning. Both original picks broke on the same day: `gemini-2.5-flash` is
 * still listed but closed to new API users, and Groq withdrew every Llama
 * chat model. When that happens again, /health catches it and this is a
 * config change rather than a deploy.
 */
export const GEMINI_FLASH: ModelRef = {
  provider: "GOOGLE",
  modelId: process.env.PANEL_GOOGLE_MODEL ?? "gemini-3.8-flash",
  label: process.env.PANEL_GOOGLE_LABEL ?? "Gemini 3.8 Flash",
};

/**
 * Qwen rather than Groq's `openai/gpt-oss-120b`, which also works but is a
 * reasoning model — a trivial reply cost 26 reasoning tokens against a
 * 6,000 TPM free-tier ceiling. Qwen answers directly, and its lineage is
 * distinct from both Gemini and the OpenAI BYOK option, so panel agreement
 * stays meaningful.
 */
export const QWEN_27B: ModelRef = {
  provider: "GROQ",
  modelId: process.env.PANEL_GROQ_MODEL ?? "qwen/qwen3.8-27b",
  label: process.env.PANEL_GROQ_LABEL ?? "Qwen 3.8 27B",
};

/**
 * The full free-tier panel: two providers, two model families. Their
 * agreement is real evidence rather than one lineage agreeing with itself.
 */
export const FREE_PANEL: ModelRef[] = [GEMINI_FLASH, QWEN_27B];

/**
 * Default model per provider for BYOK. The user brings a key; we pick a
 * sensible flagship rather than making them type a model id.
 */
export const BYOK_DEFAULT: Record<ProviderId, ModelRef> = {
  GOOGLE: GEMINI_FLASH,
  GROQ: QWEN_27B,
  ANTHROPIC: {
    provider: "ANTHROPIC",
    modelId: process.env.BYOK_ANTHROPIC_MODEL ?? "claude-sonnet-5",
    label: "Claude Sonnet 5",
  },
  OPENAI: {
    provider: "OPENAI",
    modelId: process.env.BYOK_OPENAI_MODEL ?? "gpt-5",
    label: "OpenAI GPT-5",
  },
};

/**
 * Adjudication model.
 *
 * FREE and DEMO run on Gemini Flash. That is a deliberate, known quality
 * compromise on the most correctness-critical step — which is exactly why
 * the post-hoc citation validator in the adjudicate stage is not optional:
 * with a fast judge it is the primary guard on verdict quality, not a
 * nicety. BYOK adjudicates on the user's own frontier model.
 */
export function adjudicatorFor(credential: ByokCredential | null): ModelRef {
  if (credential) return BYOK_DEFAULT[credential.provider];
  return GEMINI_FLASH;
}

/** Short, cheap work: extraction, question synthesis, claim decomposition. */
export function fastModelFor(credential: ByokCredential | null): ModelRef {
  if (credential) return BYOK_DEFAULT[credential.provider];
  return GEMINI_FLASH;
}

/** Remediation copy. */
export function writerModelFor(credential: ByokCredential | null): ModelRef {
  if (credential) return BYOK_DEFAULT[credential.provider];
  return GEMINI_FLASH;
}

/** The models under test for a given mode. */
export function panelFor(
  credential: ByokCredential | null,
  maxModels: number,
): ModelRef[] {
  const panel = credential ? [BYOK_DEFAULT[credential.provider]] : FREE_PANEL;
  return panel.slice(0, Math.max(1, maxModels));
}

// ---------------------------------------------------------------- clients

const SERVER_KEY_ENV: Record<ProviderId, string> = {
  GOOGLE: "GOOGLE_GENERATIVE_AI_API_KEY",
  GROQ: "GROQ_API_KEY",
  ANTHROPIC: "ANTHROPIC_API_KEY",
  OPENAI: "OPENAI_API_KEY",
};

export function serverKeyFor(provider: ProviderId): string | undefined {
  return process.env[SERVER_KEY_ENV[provider]];
}

export function hasServerKey(provider: ProviderId): boolean {
  return Boolean(serverKeyFor(provider));
}

/**
 * Resolve a model reference to a callable language model.
 *
 * The key is passed straight into the provider factory and never stored,
 * never returned, and never attached to the returned object in a readable
 * form. Callers hold it only for the duration of one request.
 */
export function languageModel(
  ref: ModelRef,
  credential: ByokCredential | null = null,
): LanguageModel {
  const apiKey =
    credential && credential.provider === ref.provider
      ? credential.apiKey
      : serverKeyFor(ref.provider);

  if (!apiKey) throw new MissingCredentialError(ref.provider);

  switch (ref.provider) {
    case "GOOGLE":
      return createGoogleGenerativeAI({ apiKey })(ref.modelId);
    case "GROQ":
      return createGroq({ apiKey })(ref.modelId);
    case "ANTHROPIC":
      return createAnthropic({ apiKey })(ref.modelId);
    case "OPENAI":
      return createOpenAI({ apiKey })(ref.modelId);
  }
}

export function providerLabel(provider: ProviderId): string {
  switch (provider) {
    case "GOOGLE":
      return "Google AI Studio";
    case "GROQ":
      return "Groq";
    case "ANTHROPIC":
      return "Anthropic";
    case "OPENAI":
      return "OpenAI";
  }
}
