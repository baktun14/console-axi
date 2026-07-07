import { validateSDL } from "@akashnetwork/chain-sdk";
import jsyaml from "js-yaml";

import { AxiError } from "../errors.js";
import { lintSdl } from "./lint.js";
import type { SdlDoc, SdlIssue, SdlValidation } from "./types.js";

/** ajv-style error entry returned by chain-sdk's validateSDL. */
interface SchemaError {
  instancePath?: string;
  message?: string;
  keyword?: string;
  params?: Record<string, unknown>;
}

/** Parse SDL YAML into an object, surfacing YAML errors as an SdlIssue. */
export function parseSdlYaml(yaml: string): { parsed?: SdlDoc; error?: SdlIssue } {
  let parsed: unknown;
  try {
    parsed = jsyaml.load(yaml);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: { path: "(root)", message: `Invalid YAML: ${msg}`, hint: "Check indentation and syntax." } };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: { path: "(root)", message: "SDL is empty or not a YAML mapping." } };
  }
  return { parsed: parsed as SdlDoc };
}

/**
 * Validate an SDL string offline: YAML parse -> chain-sdk schema+relational
 * checks -> local best-practice lint. Never throws; collects every issue.
 */
export function validateSdl(yaml: string): SdlValidation {
  const { parsed, error } = parseSdlYaml(yaml);
  if (error || !parsed) {
    return { valid: false, errors: error ? [error] : [{ path: "(root)", message: "SDL could not be parsed." }] };
  }

  const issues: SdlIssue[] = [];
  let schemaErrors: unknown;
  try {
    schemaErrors = validateSDL(parsed as never);
  } catch (e) {
    // Defensive: a badly-shaped document can make the validator throw.
    const msg = e instanceof Error ? e.message : String(e);
    return { valid: false, errors: [{ path: "(root)", message: `SDL is malformed: ${msg}` }], parsed };
  }

  if (Array.isArray(schemaErrors)) {
    for (const err of schemaErrors as SchemaError[]) {
      const hint = hintFor(err);
      issues.push({
        path: err.instancePath && err.instancePath.length > 0 ? err.instancePath : "(root)",
        message: err.message ?? "Invalid SDL.",
        ...(hint ? { hint } : {})
      });
    }
  }

  issues.push(...lintSdl(parsed));

  return { valid: issues.length === 0, errors: issues, parsed };
}

/**
 * Validate before an expensive API call; throw a usage error if invalid so an
 * agent never spends a deposit on an SDL that cannot deploy.
 */
export function assertSdlValid(yaml: string): SdlDoc | undefined {
  const { valid, errors, parsed } = validateSdl(yaml);
  if (valid) return parsed;
  const shown = errors.slice(0, 5).map((e) => `${e.path}: ${e.message}`).join(" | ");
  const more = errors.length > 5 ? ` (+${errors.length - 5} more)` : "";
  throw new AxiError({
    code: "usage",
    message: `SDL validation failed: ${shown}${more}`,
    help: ["console-axi sdl validate <file>", "re-run with --skip-validation to bypass this check"]
  });
}

function hintFor(err: SchemaError): string | undefined {
  const p = err.params ?? {};
  if (err.keyword === "required" && typeof p.missingProperty === "string") {
    return `Add the missing "${p.missingProperty}" field.`;
  }
  if (err.keyword === "additionalProperties" && typeof p.additionalProperty === "string") {
    return `Remove or rename the unknown field "${p.additionalProperty}".`;
  }
  return undefined;
}
