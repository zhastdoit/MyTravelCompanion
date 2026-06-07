import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    // Default to node; individual `.tsx` component tests can opt in to jsdom
    // via the `// @vitest-environment jsdom` annotation per-file.
    environment: "node",
    globals: true,
    include: [
      "lib/**/*.{test,spec}.ts",
      "app/**/*.{test,spec}.ts",
      "app/**/*.{test,spec}.tsx",
    ],
  },
});
