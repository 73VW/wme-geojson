import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    environment: "node",
    environmentMatchGlobs: [
      ["src/__tests__/promptFinalFieldsDefault.test.ts", "happy-dom"],
      ["src/__tests__/mteStore.test.ts", "happy-dom"],
      ["src/__tests__/SourcePersistence.test.ts", "happy-dom"],
      ["src/__tests__/SourceStore.test.ts", "happy-dom"],
    ],
  },
});
