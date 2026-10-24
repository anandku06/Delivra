import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Use tsx to handle TypeScript files directly (matches the project's dev runner)
    // Vitest natively understands TypeScript so no extra transform needed.
    include: ["src/**/*.test.ts"],
    // Isolate each test file to prevent module-level singleton leakage (e.g. Redis connections)
    isolate: true,
    // Shorter timeout — tests should be fast (they mock all I/O)
    testTimeout: 10_000,
  },
});
