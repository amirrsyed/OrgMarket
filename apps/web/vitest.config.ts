import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  ssr: {
    noExternal: ["@orgmarket/engine"],
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    server: {
      deps: {
        inline: ["@orgmarket/engine"],
      },
    },
  },
});
