import { afterEach, describe, expect, it, vi } from "vitest";

import type { ResolvedConfig } from "../config/config.js";
import { resetDebug, setDebug } from "../debug.js";
import { AxiError } from "../errors.js";
import { chat, chatStream, listModels } from "./client.js";

const CONFIG: ResolvedConfig = {
  apiKey: undefined,
  baseUrl: "https://api.test",
  providerProxyUrl: "https://proxy.test",
  network: "mainnet",
  consoleWebUrl: "https://console.test",
  akashmlApiKey: "akml-test-secret-key",
  akashmlBaseUrl: "https://api.akashml.test"
};

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers }
  });
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    }
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("listModels", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetDebug();
  });

  it("GETs /v1/models with a bearer header and unwraps the {data:[...]} envelope", async () => {
    const models = [
      {
        id: "MiniMaxAI/MiniMax-M2.5",
        name: "MiniMax M2.5",
        context_length: 128000,
        max_output_length: 4096,
        quantization: "fp8",
        supported_features: ["chat", "tools", "streaming"],
        pricing: { input: 0.1, output: 0.3 }
      }
    ];
    const fetchMock = vi.fn(async () => jsonResponse({ data: models }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await listModels(CONFIG);

    expect(result).toEqual(models);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.akashml.test/v1/models");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer akml-test-secret-key");
  });

  it("logs redacted request/response timing to stderr when debug is enabled", async () => {
    const lines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      lines.push(chunk.toString());
      return true;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ data: [] }))
    );
    setDebug(true);

    await listModels(CONFIG);

    const debugLines = lines.filter((line) => line.startsWith("[debug] akashml"));
    expect(debugLines).toHaveLength(1);
    expect(debugLines[0]).toMatch(/GET https:\/\/api\.akashml\.test\/v1\/models -> 200 \(\d+ms\)/);
    expect(debugLines[0]).not.toContain("akml-test-secret-key");
  });

  it("translates a non-2xx response into an AxiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, { status: 401 }))
    );

    await expect(listModels(CONFIG)).rejects.toSatisfy(
      (error: unknown) => error instanceof AxiError && error.code === "unauthorized"
    );
  });

  it("translates a fetch rejection into a network AxiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );

    await expect(listModels(CONFIG)).rejects.toSatisfy(
      (error: unknown) => error instanceof AxiError && error.code === "network"
    );
  });
});

describe("chat", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("POSTs /v1/chat/completions non-streaming and returns the parsed completion", async () => {
    const completion = {
      id: "cmpl-1",
      model: "MiniMaxAI/MiniMax-M2.5",
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 }
    };
    const fetchMock = vi.fn(async () => jsonResponse(completion));
    vi.stubGlobal("fetch", fetchMock);

    const result = await chat(CONFIG, {
      model: "MiniMaxAI/MiniMax-M2.5",
      messages: [{ role: "user", content: "hi" }]
    });

    expect(result).toEqual(completion);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.akashml.test/v1/chat/completions");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.stream).toBe(false);
  });
});

describe("chatStream", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends stream:true + stream_options.include_usage, assembles deltas, and returns usage/finishReason", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        'data: {"choices":[{"index":0,"delta":{"content":"Hel"}}]}\n\n',
        'data: {"choices":[{"index":0,"delta":{"content":"lo"}}]}\n\n',
        'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
        "data: [DONE]\n\n"
      ])
    );
    vi.stubGlobal("fetch", fetchMock);
    const deltas: unknown[] = [];

    const result = await chatStream(
      CONFIG,
      { model: "MiniMaxAI/MiniMax-M2.5", messages: [{ role: "user", content: "hi" }] },
      (delta) => deltas.push(delta)
    );

    expect(deltas).toEqual([{ content: "Hel" }, { content: "lo" }, {}]);
    expect(result).toEqual({ usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }, finishReason: "stop" });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it("passes through reasoning deltas so the caller can decide what to do with them", async () => {
    vi.stubGlobal("fetch", async () =>
      sseResponse([
        'data: {"choices":[{"index":0,"delta":{"reasoning_content":"thinking..."}}]}\n\n',
        "data: [DONE]\n\n"
      ])
    );
    const deltas: unknown[] = [];

    await chatStream(CONFIG, { model: "m", messages: [{ role: "user", content: "hi" }] }, (delta) =>
      deltas.push(delta)
    );

    expect(deltas).toEqual([{ reasoning_content: "thinking..." }]);
  });

  it("translates a non-2xx response into an AxiError before any streaming happens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, { status: 429, headers: { "retry-after": "12" } }))
    );

    await expect(chatStream(CONFIG, { model: "m", messages: [{ role: "user", content: "hi" }] }, () => {})).rejects.toSatisfy(
      (error: unknown) => error instanceof AxiError && error.code === "rate_limited" && error.details?.retryAfter === "12"
    );
  });
});
