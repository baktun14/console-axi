import { existsSync, readFileSync } from "node:fs";

import { AxiError } from "./errors.js";

/**
 * Read a value from a file path, or from stdin when the argument is `-`.
 * Used for `--sdl` / `--manifest` so agents can pipe content directly.
 */
export function readFileOrStdin(pathOrDash: string): string {
  if (pathOrDash === "-") {
    return readFileSync(0, "utf8");
  }
  if (!existsSync(pathOrDash)) {
    throw new AxiError({ code: "usage", message: `File not found: ${pathOrDash}` });
  }
  return readFileSync(pathOrDash, "utf8");
}
