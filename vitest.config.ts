import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Resolve the project root so that the `@/*` alias mirrors tsconfig.json
// (`paths: { "@/*": ["./*"] }`). Using `fileURLToPath` keeps this ESM-safe.
const projectRoot = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": projectRoot,
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: [
      "tests/**/*.{test,spec}.{ts,tsx}",
      "tests/properties/**/*.{test,spec}.{ts,tsx}",
    ],
    css: false,
  },
});
