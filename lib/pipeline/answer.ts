import { CAPS } from "@/lib/config";
import { callText, type CallContext, type CallRecord } from "@/lib/llm/call";
import type { ModelRef } from "@/lib/llm/models";
import { displayName } from "@/lib/pipeline/questions";
import { getSearchProvider } from "@/lib/search/tavily";
import type { RetrievedSnippet } from "@/lib/search/types";

/**
 * The two conditions.
 *
 * MEMORY asks the model what it believes, with no tools. BROWSING gives it
 * snippets we retrieved ourselves and asks the same question. The difference
 * between the two answers is the entire product, so the ONLY thing that may
 * differ between them is the presence of retrieved context — same model, same
 * question, same instructions, same token budget.
 */

export type ConditionAnswer = {
  condition: "MEMORY" | "BROWSING";
  model: string;
  modelLabel: string;
  text: string | null;
  error: string | null;
  latencyMs: number | null;
  searchQuery: string | null;
  retrieval: RetrievedSnippet[];
  records: CallRecord[];
};

function systemFor(domain: string, condition: "MEMORY" | "BROWSING"): string {
  const company = displayName(domain);
  const shared =
    `You are answering a customer's question about ${company} (${domain}). ` +
    `Be specific about numbers, prices, plans and limits. If you are unsure, ` +
    `say so plainly rather than guessing. Answer in at most four sentences.`;

  return condition === "MEMORY"
    ? `${shared} Answer only from your own knowledge. You have no browsing and no sources.`
    : `${shared} Sources retrieved from the web are provided. Prefer them over your own memory where they conflict.`;
}

export async function answerFromMemory(
  model: ModelRef,
  domain: string,
  question: string,
  context: CallContext,
): Promise<ConditionAnswer> {
  const base = {
    condition: "MEMORY" as const,
    model: model.modelId,
    modelLabel: model.label,
    searchQuery: null,
    retrieval: [],
  };

  try {
    const result = await callText(
      model,
      systemFor(domain, "MEMORY"),
      question,
      context,
    );
    return {
      ...base,
      text: result.value,
      error: null,
      latencyMs: result.record.latencyMs,
      records: [result.record],
    };
  } catch (error) {
    return {
      ...base,
      text: null,
      error: error instanceof Error ? error.message : String(error),
      latencyMs: null,
      records: [],
    };
  }
}

export async function answerWithBrowsing(
  model: ModelRef,
  domain: string,
  question: string,
  context: CallContext,
): Promise<ConditionAnswer> {
  const base = {
    condition: "BROWSING" as const,
    model: model.modelId,
    modelLabel: model.label,
  };

  // Retrieval is ours, so every snippet the model saw is recorded and shown.
  const query = `${displayName(domain)} ${question}`.slice(0, 300);
  const search = await getSearchProvider().search(query, CAPS.SEARCH_RESULTS);

  if (search.error || search.snippets.length === 0) {
    // Browsing that retrieved nothing is not browsing. Reporting it as an
    // answer would make the condition indistinguishable from MEMORY and
    // silently void the comparison — so it fails loudly instead.
    return {
      ...base,
      text: null,
      error:
        search.error ??
        "Search returned no results, so the browsing condition could not run.",
      latencyMs: search.latencyMs,
      searchQuery: query,
      retrieval: [],
      records: [],
    };
  }

  const sources = search.snippets
    .map((s, i) => `[${i + 1}] ${s.title}\n${s.url}\n${s.snippet}`)
    .join("\n\n");

  try {
    const result = await callText(
      model,
      systemFor(domain, "BROWSING"),
      `SOURCES\n${sources}\n\nQUESTION\n${question}`,
      context,
    );
    return {
      ...base,
      text: result.value,
      error: null,
      latencyMs: result.record.latencyMs,
      searchQuery: query,
      retrieval: search.snippets,
      records: [result.record],
    };
  } catch (error) {
    return {
      ...base,
      text: null,
      error: error instanceof Error ? error.message : String(error),
      latencyMs: null,
      searchQuery: query,
      retrieval: search.snippets,
      records: [],
    };
  }
}
