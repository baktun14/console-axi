import { Buffer } from "node:buffer";

import WebSocket from "ws";

/** A message relayed back from the provider (already JSON-parsed). */
export interface RelayMessage {
  closed?: boolean;
  error?: string;
  message?: unknown;
}

/** Minimal socket surface the relay depends on (real ws or a test double). */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  once(event: string, listener: (...args: unknown[]) => void): void;
  removeAllListeners(): void;
}

export type SocketFactory = (url: string) => SocketLike;

const OPEN_STATE = WebSocket.OPEN;

const defaultSocketFactory: SocketFactory = (url) => new WebSocket(url) as unknown as SocketLike;

export interface RelayOptions {
  /** https(s) base URL of the provider-proxy. Converted to ws(s) internally. */
  proxyUrl: string;
  /** Fully-qualified provider endpoint URL (hostUri + /lease/.../{logs|kubeevents|shell}?...). */
  providerUrl: string;
  providerAddress: string;
  /** Returns a JWT; pass force=true to mint a fresh one after expiry. */
  ensureToken: (force?: boolean) => Promise<string>;
  /** Shell mode wraps outbound data as base64. */
  isBase64?: boolean;
  maxRotations?: number;
  /** Socket constructor; defaults to a real `ws` WebSocket (overridable in tests). */
  socketFactory?: SocketFactory;
}

/**
 * A single logical provider-proxy websocket stream, transparent across JWT
 * rotation. Mirrors deploy-web's control protocol: the first (and each shell)
 * message is a `{type:"websocket", url, auth, providerAddress}` envelope.
 */
export class ProviderProxyRelay {
  private ws?: SocketLike;
  private token = "";
  private rotations = 0;
  private closed = false;
  private readonly queue: RelayMessage[] = [];
  private readonly waiters: Array<(result: IteratorResult<RelayMessage>) => void> = [];

  constructor(private readonly opts: RelayOptions) {}

  async start(): Promise<void> {
    await this.connect();
  }

  private async connect(): Promise<void> {
    this.token = await this.opts.ensureToken(this.rotations > 0);
    const wsUrl = this.opts.proxyUrl.replace(/^http/, "ws");
    const factory = this.opts.socketFactory ?? defaultSocketFactory;
    const ws = factory(wsUrl);
    this.ws = ws;
    ws.on("message", (raw: unknown) => void this.onMessage(String(raw)));
    ws.on("close", () => this.onClose());
    ws.on("error", () => this.onClose());
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", (err: unknown) => reject(err));
    });
    this.sendEnvelope();
  }

  private sendEnvelope(data?: Uint8Array): void {
    if (!this.ws || this.ws.readyState !== OPEN_STATE) return;
    const envelope: Record<string, unknown> = {
      type: "websocket",
      url: this.opts.providerUrl,
      auth: { type: "jwt", token: this.token },
      providerAddress: this.opts.providerAddress
    };
    if (this.opts.isBase64) {
      envelope.isBase64 = true;
      if (data && data.length > 0) envelope.data = Buffer.from(data).toString("base64");
    }
    this.ws.send(JSON.stringify(envelope));
  }

  /** Send stdin data (shell mode). */
  sendData(data: Uint8Array): void {
    this.sendEnvelope(data);
  }

  private async onMessage(raw: string): Promise<void> {
    let msg: RelayMessage;
    try {
      msg = JSON.parse(raw) as RelayMessage;
    } catch {
      return;
    }
    if (msg.error === "tokenExpired") {
      await this.rotate();
      return;
    }
    this.push(msg);
  }

  private async rotate(): Promise<void> {
    if (this.rotations >= (this.opts.maxRotations ?? 3)) {
      this.push({ closed: true });
      this.end();
      return;
    }
    this.rotations++;
    this.detachSocket();
    try {
      await this.connect();
    } catch {
      this.end();
    }
  }

  private onClose(): void {
    if (this.closed) return;
    this.push({ closed: true });
    this.end();
  }

  private detachSocket(): void {
    if (!this.ws) return;
    this.ws.removeAllListeners();
    try {
      this.ws.close();
    } catch {
      // ignore
    }
    this.ws = undefined;
  }

  private push(message: RelayMessage): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: message, done: false });
    else this.queue.push(message);
  }

  private end(): void {
    this.closed = true;
    let waiter = this.waiters.shift();
    while (waiter) {
      waiter({ value: undefined as unknown as RelayMessage, done: true });
      waiter = this.waiters.shift();
    }
  }

  async *receive(): AsyncGenerator<RelayMessage> {
    while (true) {
      const buffered = this.queue.shift();
      if (buffered !== undefined) {
        yield buffered;
        continue;
      }
      if (this.closed) return;
      const next = await new Promise<IteratorResult<RelayMessage>>((resolve) => this.waiters.push(resolve));
      if (next.done) return;
      yield next.value;
    }
  }

  close(): void {
    this.detachSocket();
    this.end();
  }
}
