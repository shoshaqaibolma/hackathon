import { describe, expect, it } from "vitest";

import { cacheKey } from "@/lib/llm/cache";
import { describeCredential, inferProvider, parseCredential } from "@/lib/llm/byok";
import { scrub, scrubError } from "@/lib/llm/scrub";

/**
 * BYOK security contract. These are the non-negotiable rules from CLAUDE.md;
 * if key handling changes, these tests change with it.
 *
 * The fake keys below are syntactically valid and entirely invented.
 */
const FAKE = {
  anthropic: "sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH",
  openai: "sk-proj-AAAABBBBCCCCDDDDEEEEFFFFGGGG",
  groq: "gsk_AAAABBBBCCCCDDDDEEEEFFFFGGGG",
  google: "AIzaAAAABBBBCCCCDDDDEEEEFFFFGGGG",
} as const;

describe("parseCredential", () => {
  it("infers the provider from the key shape", () => {
    for (const [name, key] of Object.entries(FAKE)) {
      const result = parseCredential({ apiKey: key });
      expect(result.ok, `${name} should parse`).toBe(true);
      if (result.ok) {
        expect(result.credential.provider).toBe(name.toUpperCase());
      }
    }
  });

  it("honours an explicitly declared provider", () => {
    const result = parseCredential({
      apiKey: FAKE.groq,
      provider: "GROQ",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a key whose shape does not match the declared provider", () => {
    const result = parseCredential({
      apiKey: FAKE.groq,
      provider: "ANTHROPIC",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects missing, empty, and non-string keys", () => {
    for (const body of [{}, { apiKey: "" }, { apiKey: "   " }, { apiKey: 42 }]) {
      expect(parseCredential(body).ok).toBe(false);
    }
    expect(parseCredential(null).ok).toBe(false);
    expect(parseCredential("sk-ant-whatever").ok).toBe(false);
  });

  it("rejects an unreasonably long value before doing any work", () => {
    const result = parseCredential({ apiKey: `sk-ant-${"a".repeat(500)}` });
    expect(result.ok).toBe(false);
  });

  it("NEVER echoes the submitted key in an error message", () => {
    // The single most likely way a key reaches a log aggregator.
    const bogus = "sk-ant-tooshort";
    const result = parseCredential({ apiKey: bogus });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain(bogus);
      expect(result.error).not.toContain("sk-ant");
    }

    const mismatched = parseCredential({
      apiKey: FAKE.google,
      provider: "OPENAI",
    });
    if (!mismatched.ok) {
      expect(mismatched.error).not.toContain(FAKE.google);
      expect(mismatched.error).not.toContain("AIza");
    }
  });

  it("infers nothing from an unrecognised shape rather than guessing", () => {
    expect(inferProvider("hunter2")).toBeNull();
  });
});

describe("describeCredential", () => {
  it("reveals no key material, not even a suffix", () => {
    const description = describeCredential({
      provider: "ANTHROPIC",
      apiKey: FAKE.anthropic,
    });
    expect(description).not.toContain(FAKE.anthropic);
    expect(description).not.toContain(FAKE.anthropic.slice(-4));
    expect(description).toContain("ANTHROPIC");
  });
});

describe("scrub", () => {
  it("removes an exactly-known secret", () => {
    const text = `Request failed with key ${FAKE.groq} attached`;
    const cleaned = scrub(text, [FAKE.groq]);
    expect(cleaned).not.toContain(FAKE.groq);
    expect(cleaned).toContain("[REDACTED]");
  });

  it("removes a URL-encoded copy of a known secret", () => {
    const text = `https://api.example.com/v1?key=${encodeURIComponent(FAKE.google)}`;
    expect(scrub(text, [FAKE.google])).not.toContain(FAKE.google);
  });

  it("removes a truncated echo of a known secret", () => {
    // Providers often echo "sk-ant-api03…" style prefixes.
    const text = `invalid x-api-key: ${FAKE.anthropic.slice(0, 12)}...`;
    expect(scrub(text, [FAKE.anthropic])).not.toContain(
      FAKE.anthropic.slice(0, 12),
    );
  });

  it("removes key shapes we were never given", () => {
    // A provider can echo a credential we are not holding for this request.
    for (const key of Object.values(FAKE)) {
      const cleaned = scrub(`upstream said: ${key}`);
      expect(cleaned).not.toContain(key);
    }
  });

  it("redacts authorization headers and api-key fields", () => {
    const header = scrub("Authorization: Bearer abcdefghijklmnopqrstuvwxyz");
    expect(header).not.toContain("abcdefghijklmnopqrstuvwxyz");

    const json = scrub('{"api_key":"supersecretvalue123456"}');
    expect(json).not.toContain("supersecretvalue123456");
  });

  it("leaves innocuous text intact", () => {
    const text = "Connection timed out after 15000ms while fetching /pricing";
    expect(scrub(text)).toBe(text);
  });
});

describe("scrubError", () => {
  it("scrubs a thrown Error's message", () => {
    const error = new Error(`401 Unauthorized for key ${FAKE.openai}`);
    expect(scrubError(error, [FAKE.openai])).not.toContain(FAKE.openai);
  });

  it("never returns a stack trace", () => {
    const error = new Error("boom");
    const result = scrubError(error);
    expect(result).not.toContain("at ");
    expect(result).toBe("boom");
  });

  it("handles non-Error throws without leaking", () => {
    const thrown = { message: "bad key", key: FAKE.groq };
    const result = scrubError(thrown, [FAKE.groq]);
    expect(result).not.toContain(FAKE.groq);
  });

  it("bounds length so a huge provider dump cannot flood a log", () => {
    const result = scrubError(new Error("x".repeat(5000)));
    expect(result.length).toBeLessThanOrEqual(600);
  });
});

describe("cacheKey", () => {
  const base = {
    model: "gemini-2.5-flash",
    schemaName: "FactBatch",
    system: "You extract facts.",
    prompt: "Here is a page.",
  };

  it("is identical regardless of whose key ran the call", () => {
    // Two users scanning the same site must share cache rows. If a
    // credential contributed to the key, they would each pay separately.
    expect(cacheKey(base)).toBe(cacheKey(base));
  });

  it("does not contain any key material", () => {
    const key = cacheKey(base);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    for (const secret of Object.values(FAKE)) {
      expect(key).not.toContain(secret);
    }
  });

  it("changes when model, prompt, schema, toolset, or namespace change", () => {
    const original = cacheKey(base);
    expect(cacheKey({ ...base, model: "llama-3.3-70b-versatile" })).not.toBe(original);
    expect(cacheKey({ ...base, prompt: "Different page." })).not.toBe(original);
    expect(cacheKey({ ...base, schemaName: "ClaimBatch" })).not.toBe(original);
    expect(cacheKey({ ...base, toolset: "search" })).not.toBe(original);
    expect(cacheKey({ ...base, namespace: "v2" })).not.toBe(original);
  });

  it("cannot be collided by shifting content across fields", () => {
    // Fields are joined with a NUL separator, so "ab"+"c" != "a"+"bc".
    expect(cacheKey({ ...base, system: "ab", prompt: "c" })).not.toBe(
      cacheKey({ ...base, system: "a", prompt: "bc" }),
    );
  });
});
