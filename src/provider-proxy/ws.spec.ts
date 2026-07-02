import { describe, expect, it, vi } from "vitest";

import { ProviderProxyRelay, type RelayMessage, type SocketLike } from "./ws.js";

describe(ProviderProxyRelay.name, () => {
  it("sends the control envelope with the current token on connect", async () => {
    const { relay, sockets } = setup();

    await relay.start();

    const envelope = JSON.parse(sockets[0]!.sent[0]!);
    expect(envelope).toMatchObject({
      type: "websocket",
      url: "https://host/lease/1/1/1/logs",
      providerAddress: "akash1provider",
      auth: { type: "jwt", token: "tok-1" }
    });
  });

  it("yields relayed messages until the socket closes", async () => {
    const { relay, sockets } = setup();
    await relay.start();

    const received = collect(relay);
    sockets[0]!.emit("message", JSON.stringify({ message: "line-a" }));
    sockets[0]!.emit("message", JSON.stringify({ message: "line-b" }));
    sockets[0]!.emit("close");

    const messages = await received;
    expect(messages.filter((m) => !m.closed).map((m) => m.message)).toEqual(["line-a", "line-b"]);
  });

  it("reconnects with a fresh token on tokenExpired without surfacing it", async () => {
    const { relay, sockets, ensureToken } = setup({ tokens: ["tok-1", "tok-2"] });
    await relay.start();

    const received = collect(relay);
    sockets[0]!.emit("message", JSON.stringify({ error: "tokenExpired" }));
    await vi.waitFor(() => expect(sockets.length).toBe(2));

    const secondEnvelope = JSON.parse(sockets[1]!.sent[0]!);
    expect(secondEnvelope.auth.token).toBe("tok-2");
    expect(ensureToken).toHaveBeenNthCalledWith(2, true);

    sockets[1]!.emit("message", JSON.stringify({ message: "after-rotate" }));
    sockets[1]!.emit("close");

    const messages = await received;
    expect(messages.filter((m) => !m.closed).map((m) => m.message)).toEqual(["after-rotate"]);
  });

  it("stops rotating after maxRotations and ends the stream", async () => {
    const { relay, sockets } = setup({ tokens: ["t1", "t2", "t3"], maxRotations: 1 });
    await relay.start();

    const received = collect(relay);
    sockets[0]!.emit("message", JSON.stringify({ error: "tokenExpired" }));
    await vi.waitFor(() => expect(sockets.length).toBe(2));
    sockets[1]!.emit("message", JSON.stringify({ error: "tokenExpired" })); // exceeds the cap

    const messages = await received;
    expect(messages.at(-1)).toEqual({ closed: true });
  });

  function collect(relay: ProviderProxyRelay): Promise<RelayMessage[]> {
    return (async () => {
      const out: RelayMessage[] = [];
      for await (const message of relay.receive()) {
        out.push(message);
        if (message.closed) break;
      }
      return out;
    })();
  }

  function setup(input: { tokens?: string[]; maxRotations?: number } = {}) {
    const tokens = input.tokens ?? ["tok-1"];
    const ensureToken = vi.fn(async (force?: boolean) => (force ? tokens[1] ?? tokens[0]! : tokens[0]!));
    const sockets: FakeSocket[] = [];
    const relay = new ProviderProxyRelay({
      proxyUrl: "https://proxy.example",
      providerUrl: "https://host/lease/1/1/1/logs",
      providerAddress: "akash1provider",
      ensureToken,
      maxRotations: input.maxRotations ?? 3,
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      }
    });
    return { relay, sockets, ensureToken };
  }
});

/** Minimal in-memory socket that auto-opens and records sent frames. */
class FakeSocket implements SocketLike {
  readyState = 1;
  readonly sent: string[] = [];
  private readonly handlers: Record<string, Array<(...args: unknown[]) => void>> = {};

  on(event: string, listener: (...args: unknown[]) => void): void {
    (this.handlers[event] ??= []).push(listener);
  }

  once(event: string, listener: (...args: unknown[]) => void): void {
    (this.handlers[event] ??= []).push(listener);
    if (event === "open") queueMicrotask(() => this.emit("open"));
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of (this.handlers[event] ?? []).slice()) handler(...args);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  removeAllListeners(): void {
    for (const key of Object.keys(this.handlers)) delete this.handlers[key];
  }
}
