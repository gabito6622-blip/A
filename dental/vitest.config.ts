import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/dental_test",
      DENTAL_SCRYPT_N: "1024",
      DENTAL_DISABLE_RATE_LIMIT: "1",
      TZ: "UTC",
    },
  },
});
