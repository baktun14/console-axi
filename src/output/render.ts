import { encode } from "@toon-format/toon";

import { AxiError, EXIT } from "../errors.js";

/**
 * Central output layer. All command results and errors are emitted as TOON on
 * stdout (AXI principle 1). Errors additionally set the process exit code.
 *
 * A "result" is any plain object. Arrays of uniform objects render as compact
 * tables. Attach a `help` array of next-step commands (AXI principle 9).
 */
export interface RenderOptions {
  /** Next-step commands appended as a `help[]` block. */
  help?: string[];
}

export function toToon(value: unknown): string {
  return encode(value as never);
}

/** Print a successful result to stdout as TOON. */
export function printResult(result: Record<string, unknown>, options: RenderOptions = {}): void {
  const payload = options.help && options.help.length > 0 ? { ...result, help: options.help } : result;
  process.stdout.write(`${toToon(payload)}\n`);
}

/** Print a structured error to stdout as TOON and return its exit code. */
export function printError(error: unknown): number {
  const axi = normalizeError(error);
  const errBlock: Record<string, unknown> = {
    code: axi.code,
    exit: axi.exitCode,
    message: axi.message
  };
  if (axi.details && Object.keys(axi.details).length > 0) {
    errBlock.details = axi.details;
  }
  const payload: Record<string, unknown> = { error: errBlock };
  if (axi.help && axi.help.length > 0) payload.help = axi.help;
  process.stdout.write(`${toToon(payload)}\n`);
  return axi.exitCode;
}

function normalizeError(error: unknown): AxiError {
  if (error instanceof AxiError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new AxiError({ code: "internal", message, exitCode: EXIT.ERROR });
}
