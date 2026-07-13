import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage["headers"];
  body: string;
}

export interface Reply {
  status?: number;
  body?: unknown;
}

export type Responder = Reply | ((req: RecordedRequest) => Reply);

/**
 * Minimal fake of the Console API: route table keyed by "METHOD /pathname",
 * every request recorded for assertions. Registering the same route repeatedly
 * queues replies consumed in order; the last one is sticky (repeats forever) so
 * polling loops keep getting an answer.
 */
export class FakeConsoleApi {
  readonly requests: RecordedRequest[] = [];
  url = "";
  private readonly routes = new Map<string, Responder[]>();

  private constructor(private readonly server: Server) {}

  static start(): Promise<FakeConsoleApi> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => void fake.handle(req, res));
      const fake = new FakeConsoleApi(server);
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        fake.url = `http://127.0.0.1:${port}`;
        resolve(fake);
      });
    });
  }

  on(method: string, path: string, responder: Responder): this {
    const key = `${method.toUpperCase()} ${path}`;
    const queue = this.routes.get(key) ?? [];
    queue.push(responder);
    this.routes.set(key, queue);
    return this;
  }

  calls(method: string, path: string): RecordedRequest[] {
    return this.requests.filter((r) => r.method === method.toUpperCase() && r.path === path);
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const url = new URL(req.url ?? "/", "http://localhost");
    const recorded: RecordedRequest = {
      method: (req.method ?? "GET").toUpperCase(),
      path: url.pathname,
      query: url.searchParams,
      headers: req.headers,
      body: Buffer.concat(chunks).toString()
    };
    this.requests.push(recorded);

    const queue = this.routes.get(`${recorded.method} ${recorded.path}`);
    const responder = queue && queue.length > 0 ? (queue.length > 1 ? queue.shift() : queue[0]) : undefined;
    const reply: Reply =
      responder === undefined
        ? { status: 404, body: { message: "not found" } }
        : typeof responder === "function"
          ? responder(recorded)
          : responder;

    res.writeHead(reply.status ?? 200, { "content-type": "application/json" });
    res.end(JSON.stringify(reply.body ?? {}));
  }
}
