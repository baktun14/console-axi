import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeTestHome, type TestHome } from "./helpers/env.js";
import { FakeConsoleApi } from "./helpers/fake-console-api.js";
import { runCli } from "./helpers/run-cli.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const HELLO_SDL = resolve(root, "examples/hello.yml");

describe("HTTP error mapping", () => {
  let home: TestHome;
  let api: FakeConsoleApi;

  beforeEach(async () => {
    home = makeTestHome();
    api = await FakeConsoleApi.start();
  });

  afterEach(async () => {
    await api.close();
    home.cleanup();
  });

  const env = (extra: Record<string, string> = {}) =>
    home.env({ CONSOLE_API_URL: api.url, CONSOLE_API_KEY: "sk-test", ...extra });

  it("402 becomes insufficient_funds with funding help", async () => {
    api.on("POST", "/v1/deployments", { status: 402, body: { message: "Insufficient balance" } });

    const result = await runCli(
      ["deployment", "create", "--sdl", HELLO_SDL, "--deposit", "5"],
      { env: env() }
    );

    expect(result.code).toBe(1);
    const body = result.toon();
    expect(body).toMatchObject({ error: { code: "insufficient_funds", exit: 1 } });
    expect(String(body.help)).toContain("wallet balance");
  });

  it("403 becomes unauthorized", async () => {
    api.on("GET", "/v1/user/me", { status: 403, body: { message: "forbidden" } });

    const result = await runCli(["whoami"], { env: env() });

    expect(result.code).toBe(1);
    expect(result.toon()).toMatchObject({ error: { code: "unauthorized" } });
  });

  it("404 on deployment view becomes not_found with the dseq in details", async () => {
    api.on("GET", "/v1/deployments/999", { status: 404, body: { message: "no such deployment" } });

    const result = await runCli(["deployment", "view", "999"], { env: env() });

    expect(result.code).toBe(1);
    expect(result.toon()).toMatchObject({ error: { code: "not_found", details: { dseq: "999" } } });
  });

  it("500 becomes api_error with the status in details", async () => {
    api.on("GET", "/v1/user/me", { status: 500, body: { message: "boom" } });

    const result = await runCli(["whoami"], { env: env() });

    expect(result.code).toBe(1);
    expect(result.toon()).toMatchObject({ error: { code: "api_error", details: { status: 500 } } });
  });

  it("connection refused becomes a friendly network error", async () => {
    const result = await runCli(["whoami"], {
      env: home.env({ CONSOLE_API_KEY: "sk-test", CONSOLE_API_URL: "http://127.0.0.1:1" })
    });

    expect(result.code).toBe(1);
    const body = result.toon();
    expect(body).toMatchObject({ error: { code: "network", exit: 1 } });
    expect(String((body.error as { message: string }).message)).toContain("Could not reach the Console API");
  });
});
