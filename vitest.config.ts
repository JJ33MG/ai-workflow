import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    // The database tests share one database; run files one after another.
    fileParallelism: false,
  },
});
