import { existsSync, readFileSync, readSync } from "node:fs";

import { AxiError } from "./errors.js";

/**
 * Read a value from a file path, or from stdin when the argument is `-`.
 * Used for `--sdl` / `--manifest` so agents can pipe content directly.
 */
export function readFileOrStdin(pathOrDash: string): string {
  if (pathOrDash === "-") {
    return readStdin();
  }
  if (!existsSync(pathOrDash)) {
    throw new AxiError({ code: "usage", message: `File not found: ${pathOrDash}` });
  }
  return readFileSync(pathOrDash, "utf8");
}

/**
 * Read all of stdin synchronously. A plain `readFileSync(0)` throws EAGAIN when
 * fd 0 is a non-blocking pipe (common on macOS when another process pipes in),
 * so retry on EAGAIN and stop on EOF.
 */
function readStdin(): string {
  const chunks: Buffer[] = [];
  const buffer = Buffer.alloc(65536);
  for (;;) {
    let bytesRead: number;
    try {
      bytesRead = readSync(0, buffer, 0, buffer.length, null);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EAGAIN") continue; // pipe not ready yet — retry
      if (code === "EOF") break; // some platforms signal end-of-input by throwing
      throw error;
    }
    if (bytesRead === 0) break;
    chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
  }
  return Buffer.concat(chunks).toString("utf8");
}
