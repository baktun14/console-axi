import type { ResolvedConfig } from "../config/config.js";
import { debugLog } from "../debug.js";
import { AxiError } from "../errors.js";
import { translateAkashmlError } from "./errors.js";
import { parseSseStream } from "./sse.js";

/** A model as listed by `GET /v1/models`. */
export interface AkashmlModel {
  /** Slashed form, e.g. `MiniMaxAI/MiniMax-M2.5`. */
  id: string;
  name: string;
  context_length: number;
  max_output_length: number;
  quantization: string;
  /** e.g. "chat", "tools", "streaming", "reasoning". */
  supported_features: string[];
  /** USD per 1M tokens. */
  pricing: {
    input: number;
    output: number;
  };
}

export interface AkashmlMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Reasoning-effort controls accepted by later `akashml chat` tasks. */
export interface AkashmlReasoningConfig {
  effort?: string;
  max_tokens?: number;
  exclude?: boolean;
}

export interface AkashmlChatRequest {
  model: string;
  messages: AkashmlMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  stream_options?: {
    include_usage?: boolean;
  };
  reasoning?: AkashmlReasoningConfig;
}

export interface AkashmlUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface AkashmlChatCompletion {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: AkashmlMessage & { reasoning_content?: string; reasoning?: string };
    finish_reason?: string;
  }>;
  usage?: AkashmlUsage;
}

/** A streamed chat chunk's delta. Passed through as-is so the caller decides what to print. */
export interface AkashmlDelta {
  content?: string;
  reasoning_content?: string;
  reasoning?: string;
}

interface AkashmlStreamChunk {
  choices?: Array<{
    index: number;
    delta: AkashmlDelta;
    finish_reason?: string | null;
  }>;
  usage?: AkashmlUsage;
}

export interface ChatStreamResult {
  usage?: AkashmlUsage;
  finishReason?: string;
}

/** List available models. Also doubles as the auth probe (401 without a valid key). */
export async function listModels(cfg: ResolvedConfig): Promise<AkashmlModel[]> {
  const response = await akashmlRequest(cfg, { method: "GET", path: "/v1/models" });
  const envelope = (await response.json()) as { data: AkashmlModel[] };
  return envelope.data;
}

/** Non-streaming chat completion. */
export async function chat(cfg: ResolvedConfig, req: AkashmlChatRequest): Promise<AkashmlChatCompletion> {
  const response = await akashmlRequest(cfg, {
    method: "POST",
    path: "/v1/chat/completions",
    body: { ...req, stream: false }
  });
  return (await response.json()) as AkashmlChatCompletion;
}

/**
 * Streaming chat completion. Calls `onDelta` for every chunk's delta (content
 * and/or reasoning) and returns the usage/finish reason collected along the way.
 */
export async function chatStream(
  cfg: ResolvedConfig,
  req: AkashmlChatRequest,
  onDelta: (delta: AkashmlDelta) => void
): Promise<ChatStreamResult> {
  const response = await akashmlRequest(cfg, {
    method: "POST",
    path: "/v1/chat/completions",
    body: { ...req, stream: true, stream_options: { include_usage: true } }
  });

  let usage: AkashmlUsage | undefined;
  let finishReason: string | undefined;
  for await (const event of parseSseStream(response.body)) {
    const chunk = event as AkashmlStreamChunk;
    const choice = chunk.choices?.[0];
    if (choice?.delta) onDelta(choice.delta);
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (chunk.usage) usage = chunk.usage;
  }
  return { usage, finishReason };
}

interface RequestOptions {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
}

/**
 * Shared fetch helper: bearer auth, debug timing, non-2xx -> translateAkashmlError,
 * transport failures -> a `network` AxiError. Mirrors src/api/client.ts's style.
 */
async function akashmlRequest(cfg: ResolvedConfig, opts: RequestOptions): Promise<Response> {
  const url = `${cfg.akashmlBaseUrl}${opts.path}`;
  const init: RequestInit = {
    method: opts.method,
    headers: {
      Authorization: `Bearer ${cfg.akashmlApiKey ?? ""}`,
      "content-type": "application/json"
    }
  };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    debugLog("akashml", `${opts.method} ${url} -> network error (${Date.now() - startedAt}ms)`);
    throw new AxiError({
      code: "network",
      message: "Could not reach AkashML. Check connectivity and the base URL."
    });
  }
  debugLog("akashml", `${opts.method} ${url} -> ${response.status} (${Date.now() - startedAt}ms)`);

  if (!response.ok) {
    const body = await safeJson(response);
    const retryAfter = response.headers.get("retry-after") ?? undefined;
    throw translateAkashmlError(response.status, body, retryAfter);
  }
  return response;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
