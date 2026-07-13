import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BALANCES, deploymentList, deploymentListEntry, USER } from "./fixtures/api.js";
import { makeTestHome, type TestHome } from "./helpers/env.js";
import { FakeConsoleApi } from "./helpers/fake-console-api.js";
import { runCli } from "./helpers/run-cli.js";

describe("auth flow", () => {
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

  const env = (extra: Record<string, string> = {}) => home.env({ CONSOLE_API_URL: api.url, ...extra });

  it("login validates the key against /v1/user/me and persists it 0600", async () => {
    api.on("GET", "/v1/user/me", { body: USER });

    const result = await runCli(["login", "--with-key", "sk-good-key"], { env: env() });

    expect(result.code).toBe(0);
    expect(result.toon()).toMatchObject({ ok: true, loggedInAs: "max" });
    const probe = api.calls("GET", "/v1/user/me")[0];
    expect(probe?.headers["x-api-key"]).toBe("sk-good-key");

    const configFile = join(home.configDir, "config.json");
    expect(JSON.parse(readFileSync(configFile, "utf8"))).toMatchObject({ apiKey: "sk-good-key" });
    expect(statSync(configFile).mode & 0o777).toBe(0o600);
  });

  it("login with a rejected key persists nothing and exits 1", async () => {
    api.on("GET", "/v1/user/me", { status: 401, body: { message: "bad key" } });

    const result = await runCli(["login", "--with-key", "sk-bad"], { env: env() });

    expect(result.code).toBe(1);
    expect(result.toon()).toMatchObject({ error: { code: "unauthorized" } });
    expect(existsSync(join(home.configDir, "config.json"))).toBe(false);
  });

  it("whoami uses the stored key; logout removes it", async () => {
    api.on("GET", "/v1/user/me", { body: USER });
    await runCli(["login", "--with-key", "sk-stored"], { env: env() });

    const who = await runCli(["whoami"], { env: env() });
    expect(who.code).toBe(0);
    expect(who.toon()).toMatchObject({ username: "max", email: "max@example.com", emailVerified: true });
    expect(api.calls("GET", "/v1/user/me")[1]?.headers["x-api-key"]).toBe("sk-stored");

    const out = await runCli(["logout"], { env: env() });
    expect(out.code).toBe(0);
    expect(existsSync(join(home.configDir, "config.json"))).toBe(false);

    const after = await runCli(["whoami"], { env: env() });
    expect(after.code).toBe(1);
    expect(after.toon()).toMatchObject({ error: { code: "unauthorized" } });
  });

  it("home when signed in aggregates user, balance and deployments", async () => {
    api
      .on("GET", "/v1/user/me", { body: USER })
      .on("GET", "/v1/balances", { body: BALANCES })
      .on("GET", "/v1/deployments", { body: deploymentList([deploymentListEntry("42")]) });

    const result = await runCli([], { env: env({ CONSOLE_API_KEY: "sk-env" }) });

    expect(result.code).toBe(0);
    expect(result.toon()).toMatchObject({
      auth: "max (api-key)",
      wallet: "$25.50 available of $30.00",
      deployments: "1 active of 1 total"
    });
    expect(api.calls("GET", "/v1/balances")).toHaveLength(1);
    expect(api.calls("GET", "/v1/deployments")).toHaveLength(1);
  });
});
