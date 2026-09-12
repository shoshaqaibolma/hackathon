/**
 * Credential scrubber.
 *
 * A BYOK key must never reach a log line, an error message, a stack trace, or
 * an SSE error event. Provider SDKs are not careful about this — several echo
 * request headers or the full request body into their error text — so every
 * outbound error string passes through here.
 *
 * Two layers, because either alone is insufficient:
 *   1. exact redaction of keys we are actually holding this request
 *   2. pattern redaction, for key shapes we were never handed but that a
 *      provider might echo back anyway
 */

const REDACTED = "[REDACTED]";

/**
 * Known API key shapes. Deliberately broad — a false positive costs a few
 * characters of an error message, a false negative leaks a credential.
 */
const KEY_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{16,}/g, // Anthropic
  /sk-proj-[A-Za-z0-9_-]{16,}/g, // OpenAI project keys
  /sk-[A-Za-z0-9]{20,}/g, // OpenAI classic
  /gsk_[A-Za-z0-9]{20,}/g, // Groq
  /AIza[A-Za-z0-9_-]{20,}/g, // Google AI Studio
  /tvly-[A-Za-z0-9_-]{16,}/g, // Tavily
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, // any bearer token
  /("?(?:api[-_]?key|authorization|x-api-key|x-goog-api-key)"?\s*[:=]\s*"?)[^"\s,}]{8,}/gi,
];

/**
 * Redact a single known secret wherever it appears, including URL-encoded and
 * partially-quoted forms.
 */
function redactExact(text: string, secret: string): string {
  if (secret.length < 8) return text;

  let out = replaceAll(text, secret, REDACTED);
  out = replaceAll(out, encodeURIComponent(secret), REDACTED);

  // Providers sometimes echo a truncated key ("sk-ant-api03-abcd..."), so also
  // redact a long enough prefix.
  if (secret.length >= 16) {
    out = replaceAll(out, secret.slice(0, 12), REDACTED);
  }

  return out;
}

function replaceAll(haystack: string, needle: string, replacement: string): string {
  if (!needle) return haystack;
  return haystack.split(needle).join(replacement);
}

/**
 * Scrub arbitrary text. Pass any secrets held for this request so they are
 * removed exactly, not just by pattern.
 */
export function scrub(text: string, secrets: readonly string[] = []): string {
  let out = text;

  for (const secret of secrets) {
    if (secret) out = redactExact(out, secret);
  }

  for (const pattern of KEY_PATTERNS) {
    out = out.replace(pattern, (match, prefix?: string) =>
      typeof prefix === "string" ? `${prefix}${REDACTED}` : REDACTED,
    );
  }

  return out;
}

/**
 * Turn any thrown value into a safe, human-readable message.
 *
 * Stack traces are dropped entirely rather than scrubbed: they routinely
 * contain request bodies and header dumps, and nothing in the UI needs them.
 */
export function scrubError(error: unknown, secrets: readonly string[] = []): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : safeStringify(error);

  return scrub(raw, secrets).slice(0, 600);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
