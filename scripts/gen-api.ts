/**
 * Regenerate the vendored OpenAPI snapshot and the typed client schema.
 *
 * 1. Fetches the public console-api spec (scope=console hides only Stripe routes).
 * 2. Writes openapi.json (vendored so builds are hermetic).
 * 3. Runs openapi-typescript to emit src/api/schema.d.ts.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SPEC_URL = process.env.CONSOLE_API_SPEC_URL ?? "https://console-api.akash.network/v1/doc?scope=console";
const root = resolve(import.meta.dirname, "..");
const specPath = resolve(root, "openapi.json");
const schemaPath = resolve(root, "src/api/schema.d.ts");

async function main() {
  process.stderr.write(`Fetching spec from ${SPEC_URL}\n`);
  const res = await fetch(SPEC_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch spec: ${res.status} ${res.statusText}`);
  }
  const spec = await res.json();
  writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`);
  process.stderr.write(`Wrote ${specPath}\n`);

  execFileSync("npx", ["openapi-typescript", specPath, "-o", schemaPath], {
    cwd: root,
    stdio: "inherit"
  });
  process.stderr.write(`Wrote ${schemaPath}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
