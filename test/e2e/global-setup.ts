import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

/** Fail fast with a clear message instead of 30 confusing spawn errors. */
export default function setup(): void {
  const cli = process.env.E2E_CLI ?? resolve(root, "dist/cli.js");
  if (!existsSync(cli)) {
    throw new Error(`e2e target ${cli} not found — run \`npm run build\` first (or set E2E_CLI to a compiled binary).`);
  }
}
