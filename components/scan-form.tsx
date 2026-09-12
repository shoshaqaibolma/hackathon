"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { normaliseDomain } from "@/lib/domain";

/**
 * Enter-a-URL onboarding.
 *
 * Validates client-side so a typo fails instantly rather than after a crawl
 * starts and burns free-tier quota, and echoes the normalised domain back so
 * there is no doubt about what will be scanned. The server re-validates; this
 * is for feedback, not for trust.
 */
export function ScanForm() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const normalised = normaliseDomain(value);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!normalised) {
      setError("That doesn't look like a domain. Try example.com.");
      return;
    }

    setPending(true);
    router.push(`/scan/new?domain=${encodeURIComponent(normalised)}`);
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <label htmlFor="domain" className="sr-only">
            Your domain
          </label>
          <input
            id="domain"
            name="domain"
            type="text"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            placeholder="yourcompany.com"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError(null);
            }}
            aria-invalid={error !== null}
            aria-describedby={error ? "domain-error" : "domain-hint"}
            className="border-border bg-background placeholder:text-muted-foreground focus:border-foreground/40 focus:ring-foreground/10 w-full rounded-md border px-4 py-3 text-base transition-colors outline-none focus:ring-4"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="bg-foreground text-background rounded-md px-6 py-3 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Starting…" : "Audit my site"}
        </button>
      </div>

      {error ? (
        <p
          id="domain-error"
          role="alert"
          className="mt-2.5 text-sm text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      ) : (
        <p id="domain-hint" className="text-muted-foreground mt-2.5 text-sm">
          {normalised ? (
            <>
              We&rsquo;ll scan{" "}
              <span className="text-foreground font-mono">{normalised}</span> — free,
              no account, no card.
            </>
          ) : (
            <>
              Free, no account, no card. Or{" "}
              <Link href="/demo" className="text-foreground underline underline-offset-4">
                look at a finished scan
              </Link>{" "}
              first.
            </>
          )}
        </p>
      )}
    </form>
  );
}
