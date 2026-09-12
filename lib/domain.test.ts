import { describe, expect, it } from "vitest";

import { normaliseDomain } from "@/lib/domain";

/**
 * The first thing a visitor touches. A typo must fail here, instantly, rather
 * than after a crawl has started and burned free-tier quota.
 */
describe("normaliseDomain", () => {
  it("accepts what people actually paste", () => {
    for (const input of [
      "example.com",
      "www.example.com",
      "https://example.com",
      "http://www.example.com/pricing?x=1",
      "  Example.COM  ",
      "https://docs.example.co.uk/a/b",
    ]) {
      expect(normaliseDomain(input), input).not.toBeNull();
    }
  });

  it("strips scheme, www, path and case", () => {
    expect(normaliseDomain("https://WWW.Example.com/pricing")).toBe("example.com");
    expect(normaliseDomain("http://docs.example.co.uk/a")).toBe("docs.example.co.uk");
  });

  it("rejects things that are not domains", () => {
    for (const input of ["", "   ", "not a domain", "localhost", "example", "@@@"]) {
      expect(normaliseDomain(input), input).toBeNull();
    }
  });

  it("rejects a bare IP address", () => {
    // A numeric TLD is not registrable, and scanning one is never intended.
    expect(normaliseDomain("192.168.1.1")).toBeNull();
  });

  it("is idempotent", () => {
    const once = normaliseDomain("https://www.Example.com/x");
    expect(normaliseDomain(once!)).toBe(once);
  });
});
