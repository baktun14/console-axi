import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bid, bids, createdDeployment, deploymentDetail, leaseCreated } from "./fixtures/api.js";
import { makeTestHome, type TestHome } from "./helpers/env.js";
import { FakeConsoleApi } from "./helpers/fake-console-api.js";
import { runCli } from "./helpers/run-cli.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const HELLO_SDL = resolve(root, "examples/hello.yml");
const CHEAP = "akash1cheapproviderrrrrrrrrrrrrrrrrrrrrrrrr";
const PRICEY = "akash1priceyproviderrrrrrrrrrrrrrrrrrrrrrrr";

describe("deploy pipeline", () => {
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
  const deployArgs = (...extra: string[]) => ["deploy", "--sdl", HELLO_SDL, "--deposit", "0.5", ...extra];

  it("happy path: create -> pick cheapest bid -> lease -> ready URIs", async () => {
    api
      .on("POST", "/v1/deployments", { status: 201, body: createdDeployment("100") })
      .on("GET", "/v1/bids", {
        body: bids([
          bid({ dseq: "100", provider: PRICEY, amountPerBlock: "5.0" }),
          bid({ dseq: "100", provider: CHEAP, amountPerBlock: "1.6" })
        ])
      })
      .on("POST", "/v1/leases", { body: leaseCreated("100") })
      .on("GET", "/v1/deployments/100", {
        body: deploymentDetail({ dseq: "100", ready: true, uris: ["app.example.com"], provider: CHEAP })
      });

    const result = await runCli(deployArgs("--skip-screening"), { env: env() });

    expect(result.code).toBe(0);
    expect(result.toon()).toMatchObject({ ok: true, dseq: "100", providers: [CHEAP], uris: ["app.example.com"] });
    const leaseBody = JSON.parse(api.calls("POST", "/v1/leases")[0]?.body ?? "{}") as { leases: Array<{ provider: string }> };
    expect(leaseBody.leases).toEqual([{ dseq: "100", gseq: 1, oseq: 1, provider: CHEAP }]);
    expect(existsSync(join(home.configDir, "manifests", "100.json"))).toBe(true);
  });

  it("bid timeout leaves the deployment OPEN and exits 1 with recovery help", async () => {
    api
      .on("POST", "/v1/deployments", { status: 201, body: createdDeployment("200") })
      .on("GET", "/v1/bids", { body: bids([]) });

    const result = await runCli(deployArgs("--skip-screening", "--bid-timeout", "1"), { env: env() });

    expect(result.code).toBe(1);
    const body = result.toon();
    expect(body).toMatchObject({ error: { code: "no_bids", details: { dseq: "200" } } });
    expect(String((body.error as { message: string }).message)).toContain("left OPEN");
    expect(String(body.help)).toContain("bid list --dseq 200");
  });

  it("--accept with an absent provider reports the unmatched order group", async () => {
    api
      .on("POST", "/v1/deployments", { status: 201, body: createdDeployment("300") })
      .on("GET", "/v1/bids", { body: bids([bid({ dseq: "300", provider: CHEAP, amountPerBlock: "1.6" })]) });

    const result = await runCli(deployArgs("--skip-screening", "--accept", PRICEY, "--bid-timeout", "1"), {
      env: env()
    });

    expect(result.code).toBe(1);
    const body = result.toon();
    expect(body).toMatchObject({ error: { code: "no_bids" } });
    expect(String((body.error as { message: string }).message)).toContain("No bid matched the --accept strategy");
  });

  it("empty screening aborts with no_supply before creating anything", async () => {
    api.on("POST", "/v1/bid-screening", { body: { providers: [] } });

    const result = await runCli(deployArgs(), { env: env() });

    expect(result.code).toBe(1);
    expect(result.toon()).toMatchObject({ error: { code: "no_supply" } });
    expect(api.calls("POST", "/v1/deployments")).toHaveLength(0);
  });

  it("a screening outage is advisory: deploy proceeds", async () => {
    api
      .on("POST", "/v1/bid-screening", { status: 500, body: { message: "screening down" } })
      .on("POST", "/v1/deployments", { status: 201, body: createdDeployment("400") })
      .on("GET", "/v1/bids", { body: bids([bid({ dseq: "400", provider: CHEAP, amountPerBlock: "1.6" })]) })
      .on("POST", "/v1/leases", { body: leaseCreated("400") })
      .on("GET", "/v1/deployments/400", { body: deploymentDetail({ dseq: "400", ready: true, provider: CHEAP }) });

    const result = await runCli(deployArgs(), { env: env() });

    expect(result.code).toBe(0);
    expect(result.toon()).toMatchObject({ ok: true, dseq: "400" });
  });

  it("lease-create failure keeps the recovery help and exits 1", async () => {
    api
      .on("POST", "/v1/deployments", { status: 201, body: createdDeployment("500") })
      .on("GET", "/v1/bids", { body: bids([bid({ dseq: "500", provider: CHEAP, amountPerBlock: "1.6" })]) })
      .on("POST", "/v1/leases", { status: 500, body: { message: "provider rejected the manifest" } });

    const result = await runCli(deployArgs("--skip-screening"), { env: env() });

    expect(result.code).toBe(1);
    const body = result.toon();
    expect(String((body.error as { message: string }).message)).toMatch(/^Lease creation failed:/);
    expect(String(body.help)).toContain("deployment close 500");
  });

  it("ready timeout reports lease-created-not-ready and exits 1", async () => {
    api
      .on("POST", "/v1/deployments", { status: 201, body: createdDeployment("600") })
      .on("GET", "/v1/bids", { body: bids([bid({ dseq: "600", provider: CHEAP, amountPerBlock: "1.6" })]) })
      .on("POST", "/v1/leases", { body: leaseCreated("600") })
      .on("GET", "/v1/deployments/600", { body: deploymentDetail({ dseq: "600", ready: false, provider: CHEAP }) });

    const result = await runCli(deployArgs("--skip-screening", "--timeout", "1"), { env: env() });

    expect(result.code).toBe(1);
    expect(result.toon()).toMatchObject({ dseq: "600", state: "lease created, not ready yet" });
  }, 20000);
});
