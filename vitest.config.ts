import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // Agent worktrees under .claude/ hold full copies of the repo.
    exclude: [...configDefaults.exclude, ".claude/**", "dist-desktop/**"],
  },
});
