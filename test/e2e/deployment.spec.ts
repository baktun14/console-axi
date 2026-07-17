import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createdDeployment,
  deploymentDetail,
  deploymentList,
  deploymentListEntry,
  leaseCreated,
  PROVIDER_ADDRESS
} from "./fixtures/api.js";
import { makeTestHome, type TestHome } from "./helpers/env.js";
import { FakeConsoleApi } from "./helpers/fake-console-api.js";
import { runCli } from "./helpers/run-cli.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const HELLO_SDL = resolve(root, "examples/hello.yml");

describe("deployment lifecycle", () => {
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

  const env = () => home.env({ CONSOLE_API_URL: api.url, CONSOLE_API_KEY: "sk-test" });

  it("create returns dseq + txHash and caches the manifest", async () => {
    api.on("POST", "/v1/deployments", { status: 201, body: createdDeployment("100") });

    const result = await runCli(["deployment", "create", "--sdl", HELLO_SDL, "--deposit", "1"], { env: env() });

    expect(result.code).toBe(0);
    expect(result.toon()).toMatchObject({ dseq: "100", txHash: "TX123ABC", state: "open" });
    const manifest = join(home.configDir, "manifests", "100.json");
    expect(existsSync(manifest)).toBe(true);
    expect(statSync(manifest).mode & 0o777).toBe(0o600);
  });

  it("list renders a compact table with pagination counts", async () => {
    api.on("GET", "/v1/deployments", {
      body: deploymentList([deploymentListEntry("100"), deploymentListEntry("101", "closed")], 7)
    });

    const result = await runCli(["deployment", "list"], { env: env() });

    expect(result.code).toBe(0);
    const body = result.toon() as { count: string; deployments: Array<Record<string, string>> };
    expect(body.count).toBe("2 of 7 total");
    expect(body.deployments[0]).toMatchObject({ dseq: "100", state: "active", provider: PROVIDER_ADDRESS });
  });

  it("status reports readiness and service URIs", async () => {
    api.on("GET", "/v1/deployments/100", { body: deploymentDetail({ dseq: "100", ready: true, uris: ["app.example.com"] }) });

    const result = await runCli(["deployment", "status", "100"], { env: env() });

    expect(result.code).toBe(0);
    const body = result.toon() as { ready: boolean; services: Array<Record<string, string>> };
    expect(body.ready).toBe(true);
    expect(body.services[0]).toMatchObject({ service: "web", ready: "1/1", uris: "app.example.com" });
  });

  it("status reports not-ready workloads without erroring", async () => {
    api.on("GET", "/v1/deployments/100", { body: deploymentDetail({ dseq: "100", ready: false }) });

    const result = await runCli(["deployment", "status", "100"], { env: env() });

    expect(result.code).toBe(0);
    expect(result.toon()).toMatchObject({ ready: false });
  });

  it("close succeeds and is an idempotent no-op on 404", async () => {
    const manifests = join(home.configDir, "manifests");
    mkdirSync(manifests, { recursive: true });
    writeFileSync(join(manifests, "100.json"), "secret");
    writeFileSync(join(manifests, "101.json"), "secret");
    api.on("DELETE", "/v1/deployments/100", { body: { data: {} } });
    api.on("DELETE", "/v1/deployments/101", { status: 404, body: { message: "gone" } });

    const closed = await runCli(["deployment", "close", "100"], { env: env() });
    const again = await runCli(["deployment", "close", "101"], { env: env() });

    expect(closed.code).toBe(0);
    expect(closed.toon()).toMatchObject({ ok: true, state: "closed" });
    expect(again.code).toBe(0);
    expect(again.toon()).toMatchObject({ ok: true, state: "closed", note: "already closed (no-op)" });
    expect(existsSync(join(manifests, "100.json"))).toBe(false);
    expect(existsSync(join(manifests, "101.json"))).toBe(false);
  });

  it("retains the cached manifest when close fails", async () => {
    const manifest = join(home.configDir, "manifests", "100.json");
    mkdirSync(join(home.configDir, "manifests"), { recursive: true });
    writeFileSync(manifest, "secret");
    api.on("DELETE", "/v1/deployments/100", { status: 500, body: { message: "try again" } });

    const result = await runCli(["deployment", "close", "100"], { env: env() });

    expect(result.code).toBe(1);
    expect(existsSync(manifest)).toBe(true);
  });

  it("lease create reuses the manifest cached by deployment create", async () => {
    api.on("POST", "/v1/deployments", { status: 201, body: createdDeployment("100") });
    api.on("POST", "/v1/leases", { body: leaseCreated("100") });

    await runCli(["deployment", "create", "--sdl", HELLO_SDL, "--deposit", "1"], { env: env() });
    const result = await runCli(
      ["lease", "create", "--dseq", "100", "--gseq", "1", "--oseq", "1", "--provider", PROVIDER_ADDRESS],
      { env: env() }
    );

    expect(result.code).toBe(0);
    const leaseCall = api.calls("POST", "/v1/leases")[0];
    const sent = JSON.parse(leaseCall?.body ?? "{}") as { manifest: string; leases: unknown[] };
    expect(sent.manifest).toBe(createdDeployment("100").data.manifest);
    expect(sent.leases).toEqual([{ dseq: "100", gseq: 1, oseq: 1, provider: PROVIDER_ADDRESS }]);
    const cached = readFileSync(join(home.configDir, "manifests", "100.json"), "utf8");
    expect(cached).toBe(createdDeployment("100").data.manifest);
  });
});
