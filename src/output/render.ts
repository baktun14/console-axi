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

export type OutputFormat = "toon" | "json";

let flagFormat: OutputFormat | undefined;

/** Set by the global --json flag (preAction hook); overrides the env. */
export function setOutputFormat(format: OutputFormat): void {
  flagFormat = format;
}

export function resetOutputFormat(): void {
  flagFormat = undefined;
}

function activeFormat(): OutputFormat {
  if (flagFormat) return flagFormat;
  return (process.env.CONSOLE_AXI_OUTPUT ?? "").toLowerCase() === "json" ? "json" : "toon";
}

/** Whether the current invocation is emitting JSON (global --json flag or CONSOLE_AXI_OUTPUT=json). */
export function isJsonOutput(): boolean {
  return activeFormat() === "json";
}

export function toToon(value: unknown): string {
  return encode(value as never);
}

function serialize(payload: unknown): string {
  return activeFormat() === "json" ? JSON.stringify(payload, null, 2) : toToon(payload);
}

/** Print a successful result to stdout as TOON (or JSON with --json). */
export function printResult(result: Record<string, unknown>, options: RenderOptions = {}): void {
  const payload = options.help && options.help.length > 0 ? { ...result, help: options.help } : result;
  process.stdout.write(`${serialize(payload)}\n`);
}

/** Print a structured error to stdout as TOON (or JSON with --json) and return its exit code. */
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
  process.stdout.write(`${serialize(payload)}\n`);
  return axi.exitCode;
}

function normalizeError(error: unknown): AxiError {
  if (error instanceof AxiError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new AxiError({ code: "internal", message, exitCode: EXIT.ERROR });
}
