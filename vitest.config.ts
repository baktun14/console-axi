import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          globals: true,
          environment: "node",
          include: ["src/**/*.spec.ts"]
        }
      },
      {
        test: {
          name: "e2e",
          globals: true,
          environment: "node",
          include: ["test/e2e/**/*.spec.ts"],
          // Spawned-CLI tests poll real timers (bid/ready loops), so give headroom.
          testTimeout: 15000,
          globalSetup: ["./test/e2e/global-setup.ts"]
        }
      }
    ]
  }
});
