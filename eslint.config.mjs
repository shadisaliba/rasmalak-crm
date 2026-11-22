import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated output
    "public/sw.js",
    "public/workbox-*.js",
    "public/fallback-*.js",
    "tests/report/**",
    "test-results/**",
    // Agent and scratch worktrees are full copies of the repository.
    ".claude/**",
  ]),
  // R14: every LLM call goes through src/ai/orchestrator.ts.
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    ignores: ["src/ai/**"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{ group: ["@/ai/providers/*", "**/ai/providers/*"], message: "Call LLMs through src/ai/orchestrator.ts (playbook R14)." }],
      }],
      "no-restricted-syntax": ["error", {
        selector: "ImportExpression[source.value=/ai\\/providers\\//]",
        message: "Call LLMs through src/ai/orchestrator.ts (playbook R14).",
      }],
    },
  },
]);

export default eslintConfig;
