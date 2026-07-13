import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { decode } from "@toon-format/toon";

const root = fileURLToPath(new URL("../../..", import.meta.url));

export interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
  /** Decode stdout as TOON; throws if stdout is not clean TOON (the agent contract). */
  toon(): Record<string, unknown>;
}

export interface RunCliOptions {
  env: Record<string, string>;
  stdin?: string;
}

/**
 * Spawn the built CLI (dist/cli.js under node, or the E2E_CLI compiled binary)
 * and capture the full agent contract: stdout, stderr, exit code.
 */
export function runCli(args: string[], options: RunCliOptions): Promise<CliResult> {
  const binary = process.env.E2E_CLI;
  const command = binary ?? process.execPath;
  const argv = binary ? args : [resolve(root, "dist/cli.js"), ...args];

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, argv, { env: options.env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise({
        stdout,
        stderr,
        code: code ?? -1,
        toon: () => decode(stdout) as Record<string, unknown>
      });
    });
    child.stdin.end(options.stdin ?? "");
  });
}
