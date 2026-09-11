import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": import.meta.dirname },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
    // Real tests arrive in Phase 3 with lib/score.ts. Until then an empty
    // run is a pass, not a failure.
    passWithNoTests: true,
  },
});
