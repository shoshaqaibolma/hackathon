import { generateText } from "ai";

import {
  BYOK_DEFAULT,
  languageModel,
  type ByokCredential,
  type ProviderId,
} from "@/lib/llm/models";
import { scrubError } from "@/lib/llm/scrub";

/**
 * Bring-your-own-key handling.
 *
 * The contract, enforced here and tested in byok.test.ts:
 *   - accepted over POST only
 *   - held in memory for one request
 *   - never written to the database (no column exists)
 *   - never logged
 *   - never in an error message or stack trace
 *   - never part of a cache key
 *   - validated with one cheap call before a scan starts
 */

export const BYOK_DISCLOSURE =
  "Your key is used for this scan and never stored.";

const PROVIDERS: ProviderId[] = ["GOOGLE", "GROQ", "ANTHROPIC", "OPENAI"];

/**
 * Key shapes we recognise, used to infer the provider when the client did
 * not say, and to reject obvious non-keys before spending a network call.
 */
const KEY_SHAPE: Record<ProviderId, RegExp> = {
  ANTHROPIC: /^sk-ant-[A-Za-z0-9_-]{16,}$/,
  OPENAI: /^sk-(?:proj-)?[A-Za-z0-9_-]{20,}$/,
  GROQ: /^gsk_[A-Za-z0-9]{20,}$/,
  GOOGLE: /^AIza[A-Za-z0-9_-]{20,}$/,
};

export type CredentialParseResult =
  | { ok: true; credential: ByokCredential }
  | { ok: false; error: string };

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDERS as string[]).includes(value);
}

/**
 * Parse a credential out of a POST body.
 *
 * Error messages here describe the *shape* of the problem and never echo the
 * submitted value — an "invalid key: sk-ant-..." message would put the
 * credential straight into a log aggregator.
 */
export function parseCredential(body: unknown): CredentialParseResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Expected a JSON object." };
  }

  const record = body as Record<string, unknown>;
  const apiKey = record.apiKey;

  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    return { ok: false, error: "No API key supplied." };
  }

  const trimmed = apiKey.trim();

  if (trimmed.length > 400) {
    return { ok: false, error: "That value is too long to be an API key." };
  }

  const declared = record.provider;
  if (declared !== undefined && !isProviderId(declared)) {
    return {
      ok: false,
      error: `Unknown provider. Expected one of: ${PROVIDERS.join(", ")}.`,
    };
  }

  const provider = isProviderId(declared) ? declared : inferProvider(trimmed);

  if (!provider) {
    return {
      ok: false,
      error:
        "Could not tell which provider that key belongs to. Select a provider explicitly.",
    };
  }

  const shape = KEY_SHAPE[provider];
  if (!shape.test(trimmed)) {
    return {
      ok: false,
      error: `That does not look like a ${provider} API key.`,
    };
  }

  return { ok: true, credential: { provider, apiKey: trimmed } };
}

export function inferProvider(apiKey: string): ProviderId | null {
  for (const provider of PROVIDERS) {
    if (KEY_SHAPE[provider].test(apiKey)) return provider;
  }
  return null;
}

export type ValidationResult =
  | { ok: true; model: string }
  | { ok: false; error: string };

/**
 * Spend one tiny call to confirm the key works before starting a scan, so a
 * bad key fails in two seconds instead of halfway through a crawl.
 *
 * Any provider error is scrubbed before it is returned: provider SDKs
 * routinely echo request headers into their error text.
 */
export async function validateCredential(
  credential: ByokCredential,
): Promise<ValidationResult> {
  const ref = BYOK_DEFAULT[credential.provider];

  try {
    await generateText({
      model: languageModel(ref, credential),
      prompt: "Reply with the single word: ok",
      maxOutputTokens: 8,
    });
    return { ok: true, model: ref.modelId };
  } catch (error) {
    return {
      ok: false,
      error: scrubError(error, [credential.apiKey]),
    };
  }
}

/**
 * Safe description of a credential for display. Never reveals key material —
 * not even a suffix, which is enough to confirm a guess.
 */
export function describeCredential(credential: ByokCredential): string {
  return `${credential.provider} key (${credential.apiKey.length} chars)`;
}
