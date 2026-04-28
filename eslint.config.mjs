import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    ignores: [
      "node_modules/**",
      ".out/**",
      "releases/**",
      "eslint.config.mjs",
      "rollup.config.mjs",
      "vitest.config.ts",
    ],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: "module",
        project: "./tsconfig.json",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      // Extend recommended rules
      ...tseslint.configs["recommended"].rules,
      // Enforce no `any` — use `unknown` and narrow
      "@typescript-eslint/no-explicit-any": "error",
      // Consistent type imports
      "@typescript-eslint/consistent-type-imports": "warn",
      // Avoid unused variables
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];
