import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // Agent worktrees under .claude/ hold full copies of the repo.
    exclude: [...configDefaults.exclude, ".claude/**", "dist-desktop/**"],
    // Coverage gate (R4) on the server: `npm run test:coverage` fails below
    // these floors. They start just under the measured level (2026-11-04:
    // statements 66.6%, branches 52.1%, functions 72.5%, lines 69.3%).
    // Ratchet them up as coverage grows; never lower them.
    coverage: {
      provider: "v8",
      include: ["server/**/*.ts"],
      exclude: ["server/**/*.test.ts", "**/*.d.ts"],
      reporter: ["text-summary", "json-summary"],
      thresholds: { statements: 65, branches: 50, functions: 70, lines: 68 },
    },
  },
});
