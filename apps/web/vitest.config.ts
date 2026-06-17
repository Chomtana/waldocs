import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    alias: { "server-only": path.resolve(__dirname, "./src/lib/server-only-stub.ts") },
  },
});
