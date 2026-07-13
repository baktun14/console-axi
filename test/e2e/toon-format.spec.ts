import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { deploymentList, deploymentListEntry } from "./fixtures/api.js";
import { makeTestHome, type TestHome } from "./helpers/env.js";
import { FakeConsoleApi } from "./helpers/fake-console-api.js";
import { runCli } from "./helpers/run-cli.js";

/**
 * Golden snapshots of the raw TOON byte format. The stdout format is an
 * agent-facing contract: agents parse these blocks, so accidental encoder or
 * shape drift must fail loudly. Everything else asserts on decoded fields.
 */
describe("TOON output contract", () => {
  let home: TestHome;

  beforeEach(() => (home = makeTestHome()));
  afterEach(() => home.cleanup());

  it("signed-out home view", async () => {
    const result = await runCli([], { env: home.env() });

    expect(result.stdout).toMatchInlineSnapshot(`
      "bin: console-axi
      description: Deploy and manage Akash workloads via the Console managed wallet
      auth: not signed in
      help[1]: console-axi login --with-key <key>
      "
    `);
  });

  it("unauthorized whoami error", async () => {
    const result = await runCli(["whoami"], { env: home.env() });

    expect(result.stdout).toMatchInlineSnapshot(`
      "error:
        code: unauthorized
        exit: 1
        message: No API key configured. Log in with a key or set CONSOLE_API_KEY.
      help[1]: console-axi login --with-key <key>
      "
    `);
  });

  it("deployment list table", async () => {
    const api = await FakeConsoleApi.start();
    try {
      api.on("GET", "/v1/deployments", {
        body: deploymentList([deploymentListEntry("100"), deploymentListEntry("101", "closed")], 2)
      });

      const result = await runCli(["deployment", "list"], {
        env: home.env({ CONSOLE_API_URL: api.url, CONSOLE_API_KEY: "sk-test" })
      });

      expect(result.stdout).toMatchInlineSnapshot(`
        "count: 2 of 2 total
        deployments[2]{dseq,state,provider,cost}:
          "100",active,akash1provideraaaaaaaaaaaaaaaaaaaaaaaaaaaaa,$0.69/mo
          "101",closed,akash1provideraaaaaaaaaaaaaaaaaaaaaaaaaaaaa,$0.69/mo
        help[2]: console-axi deployment status <dseq>,console-axi deployment view <dseq>
        "
      `);
    } finally {
      await api.close();
    }
  });
});
