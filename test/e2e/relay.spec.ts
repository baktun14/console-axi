import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { deploymentDetail, JWT, providerHost } from "./fixtures/api.js";
import { makeTestHome, type TestHome } from "./helpers/env.js";
import { FakeConsoleApi } from "./helpers/fake-console-api.js";
import { type ConnectionScript, FakeProviderProxy, providerFrame, shellFrame } from "./helpers/fake-provider-proxy.js";
import { runCli } from "./helpers/run-cli.js";

const HOST_URI = "https://provider.fake:8443";

describe("provider-proxy relay", () => {
  let home: TestHome;
  let api: FakeConsoleApi;
  let proxy: FakeProviderProxy | undefined;

  beforeEach(async () => {
    home = makeTestHome();
    api = await FakeConsoleApi.start();
    api
      .on("GET", "/v1/deployments/100", { body: deploymentDetail({ dseq: "100" }) })
      .on("GET", `/v1/providers/${deploymentDetail({ dseq: "100" }).data.leases[0]!.id.provider}`, {
        body: providerHost(HOST_URI)
      })
      .on("POST", "/v1/create-jwt-token", { status: 201, body: JWT });
  });

  afterEach(async () => {
    await api.close();
    await proxy?.close();
    proxy = undefined;
    home.cleanup();
  });

  async function startProxy(script: ConnectionScript): Promise<FakeProviderProxy> {
    proxy = await FakeProviderProxy.start(script);
    return proxy;
  }

  const env = () =>
    home.env({
      CONSOLE_API_URL: api.url,
      CONSOLE_API_KEY: "sk-test",
      CONSOLE_PROVIDER_PROXY_URL: proxy!.url
    });

  it("logs resolves the lease, mints a JWT and streams formatted lines", async () => {
    await startProxy(({ send, close }) => {
      send(providerFrame({ name: "web-abc123", message: "hello 1" }));
      send(providerFrame({ name: "web-abc123", message: "hello 2" }));
      send(providerFrame({ name: "web-abc123", message: "hello 3" }));
      close();
    });

    const result = await runCli(["logs", "100", "--tail", "3"], { env: env() });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("[web] hello 1\n[web] hello 2\n[web] hello 3\n");
    const envelope = proxy!.envelopes[0]!;
    expect(envelope.url).toBe(`${HOST_URI}/lease/100/1/1/logs?follow=false&tail=3`);
    expect(envelope.auth).toEqual({ type: "jwt", token: JWT.data.token });
    expect(api.calls("POST", "/v1/create-jwt-token")).toHaveLength(1);
  });

  it("rotates the JWT when the provider reports tokenExpired", async () => {
    await startProxy(({ index, send, close }) => {
      if (index === 0) {
        send({ error: "tokenExpired" });
        return;
      }
      send(providerFrame({ name: "web-abc123", message: "after rotation" }));
      close();
    });

    const result = await runCli(["logs", "100", "--tail", "1"], { env: env() });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("[web] after rotation\n");
    expect(proxy!.connections).toBe(2);
    expect(api.calls("POST", "/v1/create-jwt-token")).toHaveLength(2);
  });

  it("zero log lines produces a structured empty result", async () => {
    await startProxy(({ close }) => close());

    const result = await runCli(["logs", "100"], { env: env() });

    expect(result.code).toBe(0);
    expect(result.toon()).toEqual({ logs: "0 lines returned" });
  });

  it("events formats kubernetes events", async () => {
    await startProxy(({ send, close }) => {
      send(providerFrame({ type: "Normal", reason: "Started", note: "Started container web", object: { kind: "Pod", name: "web-abc" } }));
      close();
    });

    const result = await runCli(["events", "100"], { env: env() });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("[web] [Normal] [Started] [Pod] Started container web\n");
    expect(proxy!.envelopes[0]!.url).toBe(`${HOST_URI}/lease/100/1/1/kubeevents?follow=false`);
  });

  it("exec propagates stdout and the remote exit code", async () => {
    await startProxy(({ send, close }) => {
      send(shellFrame(100, "hi\n"));
      send(shellFrame(102, '{"exit_code":0}'));
      close();
    });

    const result = await runCli(["exec", "100", "--service", "web", "--", "echo", "hi"], { env: env() });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("hi\n");
    const envelope = proxy!.envelopes[0]!;
    expect(envelope.url).toContain(`${HOST_URI}/lease/100/1/1/shell?`);
    expect(envelope.url).toContain("cmd0=echo");
    expect(envelope.url).toContain("cmd1=hi");
    expect(envelope.isBase64).toBe(true);
  });

  it("exec surfaces a nonzero remote exit code and stderr channel", async () => {
    await startProxy(({ send, close }) => {
      send(shellFrame(101, "oops\n"));
      send(shellFrame(102, '{"exit_code":7}'));
      close();
    });

    const result = await runCli(["exec", "100", "--service", "web", "--", "false"], { env: env() });

    expect(result.code).toBe(7);
    expect(result.stderr).toContain("oops");
    expect(result.stdout).toBe("");
  });
});
