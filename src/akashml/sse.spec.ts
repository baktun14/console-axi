import { describe, expect, it } from "vitest";

import { parseSseStream } from "./sse.js";

/** Build a ReadableStream<Uint8Array> that emits the given string chunks in order. */
function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    }
  });
}

async function collect(body: ReadableStream<Uint8Array>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const event of parseSseStream(body)) out.push(event);
  return out;
}

describe("parseSseStream", () => {
  it("yields a single event split across a chunk boundary mid-JSON", async () => {
    const body = streamFromChunks(['data: {"foo": "b', 'ar"}\n\n']);

    const events = await collect(body);

    expect(events).toEqual([{ foo: "bar" }]);
  });

  it("yields multiple events delivered in one chunk", async () => {
    const body = streamFromChunks(['data: {"a": 1}\n\ndata: {"a": 2}\n\ndata: {"a": 3}\n\n']);

    const events = await collect(body);

    expect(events).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it("stops iteration at data: [DONE] without yielding it", async () => {
    const body = streamFromChunks(['data: {"a": 1}\n\ndata: [DONE]\n\ndata: {"a": 2}\n\n']);

    const events = await collect(body);

    expect(events).toEqual([{ a: 1 }]);
  });

  it("skips a malformed data line without throwing", async () => {
    const body = streamFromChunks(['data: {not valid json}\n\ndata: {"a": 1}\n\n']);

    const events = await collect(body);

    expect(events).toEqual([{ a: 1 }]);
  });

  it("ignores non-data lines within an event (e.g. event:, id:, comments)", async () => {
    const body = streamFromChunks([': keep-alive\nevent: message\ndata: {"a": 1}\nid: 42\n\n']);

    const events = await collect(body);

    expect(events).toEqual([{ a: 1 }]);
  });

  it("yields nothing for a null body", async () => {
    const events: unknown[] = [];
    for await (const event of parseSseStream(null)) events.push(event);

    expect(events).toEqual([]);
  });
});
