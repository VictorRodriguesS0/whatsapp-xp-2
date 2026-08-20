import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL(
          "./node_modules/next/dist/build/jest/__mocks__/empty.js",
          import.meta.url,
        ),
      ),
    },
  },
  test: {
    environment: "jsdom",
    fileParallelism: false,
    setupFiles: ["./vitest.setup.ts"],
  },
});
