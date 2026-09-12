import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";

/**
 * HTML -> plain text, via Readability.
 *
 * The extracted text is the substrate for every fact in the ledger, and a
 * fact's evidence span must be locatable verbatim inside it. So extraction
 * must be stable and lossless enough for exact substring matching: no
 * re-wrapping, no smart-quote rewriting, no entity mangling beyond what the
 * DOM already does.
 */

export type ExtractResult = {
  title: string | null;
  text: string;
  /** Outbound links found on the page, for crawl discovery. */
  links: { href: string; anchorText: string }[];
};

/**
 * Readability targets articles and sometimes discards pricing tables and
 * nav-heavy marketing pages entirely. When it returns too little, we fall
 * back to the whole body — a noisy ledger beats an empty one, and the
 * integrity check catches genuinely empty extraction either way.
 */
const READABILITY_MIN_CHARS = 400;

export function extract(html: string, url: string): ExtractResult {
  // jsdom is loud about CSS and JS it cannot handle; none of it matters here.
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("error", () => {});
  virtualConsole.on("jsdomError", () => {});

  let dom: JSDOM;
  try {
    dom = new JSDOM(html, { url, virtualConsole });
  } catch {
    return { title: null, text: "", links: [] };
  }

  const { document } = dom.window;
  const title = document.title?.trim() || null;
  const links = collectLinks(document);

  // Readability mutates the document, so links are collected first.
  let text = "";
  try {
    const article = new Readability(document.cloneNode(true) as Document).parse();
    text = normalise(article?.textContent ?? "");
  } catch {
    text = "";
  }

  if (text.length < READABILITY_MIN_CHARS) {
    const fallback = normalise(bodyText(document));
    if (fallback.length > text.length) text = fallback;
  }

  dom.window.close();

  return { title, text, links };
}

function collectLinks(document: Document): ExtractResult["links"] {
  const links: ExtractResult["links"] = [];
  const seen = new Set<string>();

  for (const anchor of document.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#")) continue;

    let resolved: string;
    try {
      resolved = new URL(href, document.baseURI).toString();
    } catch {
      continue;
    }

    if (seen.has(resolved)) continue;
    seen.add(resolved);

    links.push({
      href: resolved,
      anchorText: (anchor.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
    });
  }

  return links;
}

function bodyText(document: Document): string {
  for (const selector of ["script", "style", "noscript", "svg", "nav", "footer"]) {
    for (const node of document.querySelectorAll(selector)) node.remove();
  }
  return document.body?.textContent ?? "";
}

/**
 * Collapses runs of whitespace but preserves paragraph breaks, so quoted
 * evidence spans stay findable while the text remains readable.
 */
function normalise(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

/**
 * Locates an evidence span inside extracted text, tolerating whitespace and
 * punctuation differences a model is likely to introduce.
 *
 * This is the mechanism behind the ledger's core invariant: a fact whose
 * span cannot be found here is dropped, never stored. Returns the offset in
 * the ORIGINAL text so the UI can highlight it, or -1.
 */
export function locateSpan(haystack: string, span: string): number {
  if (!span.trim()) return -1;

  const direct = haystack.indexOf(span);
  if (direct !== -1) return direct;

  const fold = (text: string) =>
    text
      .toLowerCase()
      .replace(/[‘’‚‛]/g, "'")
      .replace(/[“”„‟]/g, '"')
      .replace(/[‐-―]/g, "-")
      .replace(/\s+/g, " ");

  // Build a folded haystack while recording where each folded character
  // came from, so the returned offset still indexes the original text.
  const offsets: number[] = [];
  let folded = "";
  let lastWasSpace = false;

  for (let i = 0; i < haystack.length; i += 1) {
    const foldedChar = fold(haystack[i]);
    if (foldedChar === " ") {
      if (lastWasSpace) continue;
      lastWasSpace = true;
    } else {
      lastWasSpace = false;
    }
    folded += foldedChar;
    offsets.push(i);
  }

  const index = folded.indexOf(fold(span).trim());
  return index === -1 ? -1 : (offsets[index] ?? -1);
}
