import { defineConfig } from "vitest/config";

// Performance budgets (roadmap bar #5): `npm run bench`. Kept out of the
// normal test run because it builds a 10k-entry vault.
export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    include: ["server/**/*.bench.ts"],
    // One file, run alone: parallel workers would skew the timings.
    fileParallelism: false,
  },
});
