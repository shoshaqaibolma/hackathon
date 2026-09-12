/**
 * Domain normalisation for the scan input.
 *
 * Kept out of the component so it is testable without a JSX transform, and
 * because the same normalisation has to run server-side before a scan is
 * created — the client check is for fast feedback, not for trust.
 */
export function normaliseDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  let host: string;
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    host = url.hostname;
  } catch {
    return null;
  }

  host = host.replace(/^www\./, "");

  // Must look like a registrable domain: labels, then an alphabetic TLD.
  // This deliberately rejects `localhost` and bare IP addresses, neither of
  // which is ever what someone meant to scan.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(host)) {
    return null;
  }

  return host;
}
