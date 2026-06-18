import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  // Use the automatic JSX runtime so .tsx components (e.g. Markdown) compile
  // without a React import (matches Next's setup).
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    alias: { "server-only": path.resolve(__dirname, "./test/server-only-stub.ts") },
    fileParallelism: false,
    // Integration tests wipe tables in beforeEach — point them at a SEPARATE
    // database so they never touch the dev/prod data in `waldocs`.
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? "postgresql://waldocs:waldocs@localhost:5432/waldocs_test",
    },
  },
});
