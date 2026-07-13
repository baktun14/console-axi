import type { AddressInfo } from "node:net";

import { type WebSocket, WebSocketServer } from "ws";

/** The control envelope the CLI relay sends as its first (and each shell) message. */
export interface Envelope {
  type: string;
  url: string;
  auth: { type: string; token: string };
  providerAddress: string;
  isBase64?: boolean;
  data?: string;
}

export interface ConnectionContext {
  envelope: Envelope;
  /** 0-based index of this websocket connection (rotation = a new connection). */
  index: number;
  send(message: unknown): void;
  close(): void;
}

export type ConnectionScript = (ctx: ConnectionContext) => void;

/**
 * Fake of the Console provider-proxy websocket relay. The script runs once per
 * connection when the first envelope arrives; use ctx.send to reply with
 * provider frames and ctx.close to end the stream. All envelopes (including
 * shell data frames) are recorded for assertions.
 */
export class FakeProviderProxy {
  readonly envelopes: Envelope[] = [];
  connections = 0;
  url = "";

  private constructor(private readonly wss: WebSocketServer) {}

  static start(script: ConnectionScript): Promise<FakeProviderProxy> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
      const fake = new FakeProviderProxy(wss);
      wss.on("error", reject);
      wss.on("connection", (ws: WebSocket) => {
        const index = fake.connections++;
        let scripted = false;
        ws.on("message", (raw) => {
          const envelope = JSON.parse(String(raw)) as Envelope;
          fake.envelopes.push(envelope);
          if (scripted) return;
          scripted = true;
          script({
            envelope,
            index,
            send: (message) => ws.send(JSON.stringify(message)),
            close: () => ws.close()
          });
        });
      });
      wss.on("listening", () => {
        const { port } = wss.address() as AddressInfo;
        // The CLI config expects an http(s) URL; the relay rewrites http -> ws.
        fake.url = `http://127.0.0.1:${port}`;
        resolve(fake);
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.wss.close(() => resolve()));
  }
}

/** Frame a provider log/event payload the way the proxy double-encodes it. */
export function providerFrame(payload: unknown): { message: string } {
  return { message: JSON.stringify(payload) };
}

/** Frame a shell channel message (exec): first byte channel, rest utf-8 text. */
export function shellFrame(channel: number, text: string): { message: { data: number[] } } {
  return { message: { data: [channel, ...Array.from(new TextEncoder().encode(text))] } };
}
