/**
 * Minimal SSE (Server-Sent Events) reader for AkashML's streaming chat endpoint.
 * Buffers raw bytes, splits on blank-line event boundaries, and JSON-parses each
 * `data:` payload. Tolerant of malformed lines (skip, don't throw) and of the
 * `data: [DONE]` sentinel that terminates the stream.
 */
export async function* parseSseStream(body: ReadableStream<Uint8Array> | null): AsyncGenerator<unknown> {
  if (!body) return;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      if (done) {
        buffer += decoder.decode();
        for (const rawEvent of buffer.split("\n\n")) {
          const result = parseEvent(rawEvent);
          if (result === "done") return;
          if (result !== undefined) yield result;
        }
        return;
      }

      let separatorIndex: number;
      while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        const result = parseEvent(rawEvent);
        if (result === "done") return;
        if (result !== undefined) yield result;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Parse one raw event's `data:` lines. Returns `"done"` for [DONE], `undefined` to skip. */
function parseEvent(rawEvent: string): unknown | "done" | undefined {
  const dataLines = rawEvent
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^\s/, ""));
  if (dataLines.length === 0) return undefined;

  const payload = dataLines.join("\n");
  if (payload === "[DONE]") return "done";

  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}
