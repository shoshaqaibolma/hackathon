import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * DEMO mode reads fixture JSON from disk at request time. Vercel's bundler
   * only ships files it can see being imported, so trace them explicitly —
   * without this, /demo works locally and 404s in production.
   */
  outputFileTracingIncludes: {
    "/demo": ["./fixtures/**/*.json"],
    "/demo/[slug]": ["./fixtures/**/*.json"],
    // The study page renders the same markdown file the repository publishes.
    "/study": ["./reports/study.md"],
  },
};

export default nextConfig;
