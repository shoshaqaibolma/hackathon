import { z } from "zod";

/**
 * A single search result we retrieved and injected into a BROWSING prompt.
 *
 * We run retrieval ourselves rather than using provider-native grounding.
 * Free-tier grounding quotas are unreliable, but the bigger win is that this
 * is inspectable: every snippet the model saw is stored and shown in the UI.
 * A provider's built-in search tool is a black box by comparison.
 */
export const RetrievedSnippetSchema = z.object({
  title: z.string(),
  url: z.string(),
  /** The text actually placed in the prompt, already truncated. */
  snippet: z.string(),
  /** Provider relevance score, when the adapter supplies one. */
  score: z.number().nullable().default(null),
  /** Publication date when known — useful for explaining staleness. */
  publishedAt: z.string().nullable().default(null),
});

export type RetrievedSnippet = z.infer<typeof RetrievedSnippetSchema>;

/** What a search adapter returns for one query. */
export const SearchResultSchema = z.object({
  query: z.string(),
  snippets: z.array(RetrievedSnippetSchema),
  provider: z.string(),
  latencyMs: z.number().nullable().default(null),
  /** Set when retrieval failed. Surfaced in the UI, never swallowed. */
  error: z.string().nullable().default(null),
});

export type SearchResult = z.infer<typeof SearchResultSchema>;

/**
 * The interface every search backend implements. Tavily is the first adapter;
 * swapping it must not touch the pipeline.
 */
export type SearchProvider = {
  readonly name: string;
  search(query: string, limit: number): Promise<SearchResult>;
};
