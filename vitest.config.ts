import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    environment: "node",
    environmentMatchGlobs: [["src/__tests__/SourcePersistence.test.ts", "happy-dom"]],
  },
});
