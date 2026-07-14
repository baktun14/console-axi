import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { gpuPrices, providerListEntry, screenedModel, screenedProviders } from "./fixtures/api.js";
import { makeTestHome, type TestHome } from "./helpers/env.js";
import { FakeConsoleApi } from "./helpers/fake-console-api.js";
import { runCli } from "./helpers/run-cli.js";

/** Live provider count per model, keyed off the bid-screening request body. */
const LIVE_BY_MODEL: Record<string, number> = { a100: 1, h100: 4 };

describe("gpu / provider marketplace commands", () => {
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

  const env = () => home.env({ CONSOLE_API_URL: api.url });

  // A bid-screening responder that answers per requested GPU model (0 for cpu-only).
  const perModelScreening = () =>
    api.on("POST", "/v1/bid-screening", (req) => {
      const model = screenedModel(req.body);
      const n = LIVE_BY_MODEL[model] ?? 0;
      return { body: screenedProviders(Array.from({ length: n }, (_, i) => `akash1${model || "cpu"}${i}`)) };
    });

  it("gpu list: shows the freshness note, no live column, and does not call bid-screening", async () => {
    api.on("GET", "/v1/gpu-prices", {
      body: gpuPrices([
        { model: "a100", available: 5, providers: 1 },
        { model: "h100", available: 20, providers: 3 }
      ])
    });

    const result = await runCli(["gpu", "list"], { env: env() });

    expect(result.code).toBe(0);
    const out = result.toon() as { note?: string; gpus: Array<Record<string, unknown>> };
    expect(out.note).toMatch(/15 min/);
    expect(out.gpus[0]).not.toHaveProperty("live");
    expect(api.calls("POST", "/v1/bid-screening")).toHaveLength(0);
  });

  it("gpu list --verify: adds a live column from bid-screening (one call per distinct model)", async () => {
    api.on("GET", "/v1/gpu-prices", {
      body: gpuPrices([
        { model: "a100", available: 5, providers: 1 },
        { model: "h100", available: 20, providers: 3 }
      ])
    });
    perModelScreening();

    const result = await runCli(["gpu", "list", "--verify"], { env: env() });

    expect(result.code).toBe(0);
    const rows = (result.toon() as { gpus: Array<Record<string, string>> }).gpus;
    const byModel = Object.fromEntries(rows.map((r) => [r.model, r.live]));
    expect(byModel).toEqual({ a100: "1", h100: "4" });
    expect(api.calls("POST", "/v1/bid-screening")).toHaveLength(2);
  });

  it("gpu --available --verify: drops models with no live supply", async () => {
    api.on("GET", "/v1/gpu-prices", {
      body: gpuPrices([
        { model: "a100", available: 5, providers: 1 },
        { model: "rtx3060", available: 5, providers: 2 } // no live providers -> dropped
      ])
    });
    perModelScreening();

    const result = await runCli(["gpu", "--available", "--verify"], { env: env() });

    expect(result.code).toBe(0);
    const rows = (result.toon() as { gpus: Array<Record<string, string>> }).gpus;
    expect(rows.map((r) => r.model)).toEqual(["a100"]);
  });

  it("provider list --live: annotates who would bid now and counts them", async () => {
    api.on("GET", "/v1/providers", {
      body: [
        providerListEntry({ owner: "akash1alive" }),
        providerListEntry({ owner: "akash1bdead" })
      ] as unknown as Record<string, unknown>
    });
    // Only the first provider would currently bid.
    api.on("POST", "/v1/bid-screening", { body: screenedProviders(["akash1alive"]) });

    const result = await runCli(["provider", "list", "--live"], { env: env() });

    expect(result.code).toBe(0);
    const out = result.toon() as { liveBiddable: string; providers: Array<Record<string, string>> };
    expect(out.liveBiddable).toMatch(/1 of 2/);
    const live = Object.fromEntries(out.providers.map((p) => [p.owner, p.live]));
    expect(live).toEqual({ akash1alive: "yes", akash1bdead: "no" });
  });

  it("provider list: no live column and no bid-screening call by default", async () => {
    api.on("GET", "/v1/providers", {
      body: [providerListEntry({ owner: "akash1alive" })] as unknown as Record<string, unknown>
    });

    const result = await runCli(["provider", "list"], { env: env() });

    expect(result.code).toBe(0);
    expect((result.toon() as { providers: Array<Record<string, unknown>> }).providers[0]).not.toHaveProperty("live");
    expect(api.calls("POST", "/v1/bid-screening")).toHaveLength(0);
  });
});
