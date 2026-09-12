import { z } from "zod";

/**
 * Scan integrity check.
 *
 * Runs before a scan may be marked COMPLETE. A pipeline can finish every
 * stage without throwing and still produce a structurally meaningless
 * result: a crawl that captured four cookie banners, a browsing condition
 * that silently retrieved nothing, a panel member that dropped half the
 * questions. Each of those yields a Parity Score that looks exactly like a
 * real one.
 *
 * That is the failure mode worth preventing. A wrong number presented
 * confidently is worse than no number, and it is precisely the failure this
 * product exists to catch in other systems.
 *
 * Pure and total — no database, no network. Everything here is unit-tested.
 */

export const IntegrityCodeValues = [
  "PAGE_TEXT_TOO_SHORT",
  "PAGE_LOOKS_LIKE_CONSENT_WALL",
  "PAGE_LOOKS_LIKE_JS_SHELL",
  "QUESTION_NO_SEARCH_RESULTS",
  "QUESTION_MISSING_ANSWER",
  "ANSWER_NO_CLAIMS",
] as const;

export type IntegrityCode = (typeof IntegrityCodeValues)[number];

export const IntegrityViolationSchema = z.object({
  code: z.enum(IntegrityCodeValues),
  /** What the violation is about: a URL, a question, a model name. */
  subject: z.string(),
  /** Plain-language explanation, rendered directly in the UI. */
  message: z.string(),
});

export type IntegrityViolation = z.infer<typeof IntegrityViolationSchema>;

/**
 * Below this, an extracted page is not usable source material. A real
 * pricing or docs page runs to thousands of characters; a few hundred means
 * extraction hit a wall, not that the company is terse.
 */
export const MIN_PAGE_TEXT_CHARS = 300;

/** Phrases that indicate a consent interstitial rather than page content. */
const CONSENT_MARKERS = [
  "we use cookies",
  "this site uses cookies",
  "uses cookies",
  "accept all cookies",
  "accept cookies",
  "cookie policy",
  "cookie preferences",
  "manage preferences",
  "privacy preferences",
  "your privacy choices",
  "consent to the use of cookies",
  "necessary cookies",
  "reject all",
];

/** Phrases that indicate an unrendered client-side app shell. */
const JS_SHELL_MARKERS = [
  "enable javascript",
  "javascript is required",
  "javascript is disabled",
  "please turn on javascript",
  "you need to enable javascript to run this app",
  "this application requires javascript",
];

function countMarkers(haystack: string, markers: readonly string[]): number {
  let count = 0;
  for (const marker of markers) {
    if (haystack.includes(marker)) count += 1;
  }
  return count;
}

/**
 * Two independent markers, or one marker in a page too short to be anything
 * else. A long article that merely mentions cookies in passing does not trip
 * this — the length guard is what keeps the heuristic honest.
 */
export function looksLikeConsentWall(text: string): boolean {
  const haystack = text.toLowerCase();
  const hits = countMarkers(haystack, CONSENT_MARKERS);
  if (hits === 0) return false;
  return hits >= 2 || text.length < 1_200;
}

export function looksLikeJsShell(text: string): boolean {
  return countMarkers(text.toLowerCase(), JS_SHELL_MARKERS) > 0;
}

// ---------------------------------------------------------------- input

export type IntegrityPage = {
  url: string;
  /** Only OK pages are checked; other statuses are already honest failures. */
  status: string;
  extractedText: string | null;
};

export type IntegrityQuestion = {
  id: string;
  text: string;
};

export type IntegrityAnswer = {
  questionId: string;
  model: string;
  condition: "MEMORY" | "BROWSING";
  /** Claims decomposed from this answer. */
  claimCount: number;
  /** Snippets retrieved for the BROWSING condition. */
  retrievalCount: number;
  error: string | null;
  rawText: string | null;
};

export type IntegrityInput = {
  pages: readonly IntegrityPage[];
  questions: readonly IntegrityQuestion[];
  /** Models that were supposed to answer, in panel order. */
  panelModels: readonly string[];
  answers: readonly IntegrityAnswer[];
  /** False when the browsing condition was deliberately not run. */
  browsingEnabled: boolean;
};

export type IntegrityReport = {
  ok: boolean;
  violations: IntegrityViolation[];
};

function shorten(text: string, max = 70): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * Returns every violation, not just the first. An operator fixing a broken
 * scan needs the whole list, and a single symptom rarely has a single cause.
 */
export function checkScanIntegrity(input: IntegrityInput): IntegrityReport {
  const violations: IntegrityViolation[] = [];

  // --- pages ------------------------------------------------------------
  for (const page of input.pages) {
    if (page.status !== "OK") continue;

    const text = page.extractedText ?? "";

    if (text.trim().length < MIN_PAGE_TEXT_CHARS) {
      violations.push({
        code: "PAGE_TEXT_TOO_SHORT",
        subject: page.url,
        message: `Extracted only ${text.trim().length} characters (minimum ${MIN_PAGE_TEXT_CHARS}). The page was fetched but yielded no usable content.`,
      });
      // A near-empty page will also trip the heuristics below; one clear
      // violation per page is more actionable than three.
      continue;
    }

    if (looksLikeJsShell(text)) {
      violations.push({
        code: "PAGE_LOOKS_LIKE_JS_SHELL",
        subject: page.url,
        message:
          "Extracted text looks like an unrendered JavaScript app shell, not page content. Parity does not run a headless browser.",
      });
      continue;
    }

    if (looksLikeConsentWall(text)) {
      violations.push({
        code: "PAGE_LOOKS_LIKE_CONSENT_WALL",
        subject: page.url,
        message:
          "Extracted text looks like a cookie or consent interstitial rather than page content.",
      });
    }
  }

  // --- answers ----------------------------------------------------------
  const byKey = new Map<string, IntegrityAnswer>();
  for (const answer of input.answers) {
    byKey.set(`${answer.questionId}|${answer.model}|${answer.condition}`, answer);
  }

  const conditions: IntegrityAnswer["condition"][] = input.browsingEnabled
    ? ["MEMORY", "BROWSING"]
    : ["MEMORY"];

  for (const question of input.questions) {
    for (const model of input.panelModels) {
      for (const condition of conditions) {
        const answer = byKey.get(`${question.id}|${model}|${condition}`);

        // Missing entirely, or present but failed — either way this question
        // has no answer from this panel member, so the score denominator is
        // wrong and the result is not comparable.
        if (!answer || answer.error || !answer.rawText?.trim()) {
          violations.push({
            code: "QUESTION_MISSING_ANSWER",
            subject: `${model} · ${condition}`,
            message: `No usable ${condition} answer from ${model} for “${shorten(question.text)}”${
              answer?.error ? `: ${answer.error}` : "."
            }`,
          });
          continue;
        }

        if (condition === "BROWSING" && answer.retrievalCount === 0) {
          violations.push({
            code: "QUESTION_NO_SEARCH_RESULTS",
            subject: `${model} · ${shorten(question.text)}`,
            message:
              "The browsing condition retrieved zero sources, so it was indistinguishable from the memory condition and the comparison is void.",
          });
        }

        if (answer.claimCount === 0) {
          violations.push({
            code: "ANSWER_NO_CLAIMS",
            subject: `${model} · ${condition}`,
            message: `The ${condition} answer to “${shorten(question.text)}” produced no atomic claims, so nothing was adjudicated and it contributed nothing to the score.`,
          });
        }
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

/** One-line summary for the scan header. */
export function summariseIntegrity(violations: readonly IntegrityViolation[]): string {
  if (violations.length === 0) return "All integrity checks passed.";

  const counts = new Map<IntegrityCode, number>();
  for (const violation of violations) {
    counts.set(violation.code, (counts.get(violation.code) ?? 0) + 1);
  }

  const parts = [...counts.entries()].map(([code, n]) => `${n}× ${code}`);
  return `Scan is structurally incomplete: ${parts.join(", ")}. No Parity Score is shown, because one computed from this data would be misleading.`;
}
