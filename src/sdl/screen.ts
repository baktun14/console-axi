import { type ApiClient, unwrap } from "../api/client.js";
import type { operations } from "../api/schema.js";
import { deriveResources } from "./resources.js";
import type { SdlDoc } from "./types.js";

/** A provider returned by POST /v1/bid-screening. Derived from the generated schema to stay in sync. */
export type ScreenedProvider =
  operations["screenProviders"]["responses"][200]["content"]["application/json"]["providers"][number];

type Incident = ScreenedProvider["incidents"][number];

interface ScreenRequirements {
  signedBy?: { anyOf: string[]; allOf: string[] };
  attributes?: Array<{ key: string; value: string }>;
}

/**
 * Probe network supply for an SDL: derive its resource units, ask the
 * bid-screening endpoint which providers could bid, and return them. Advisory
 * only — providers may run custom bid scripts, so a match is not a guarantee.
 * Throws (translated AxiError) on transport/HTTP failure; callers decide whether
 * that is fatal (`sdl screen`) or best-effort (`sdl estimate`, `deploy`).
 */
export async function screenSupply(
  client: ApiClient,
  sdl: SdlDoc,
  opts: { reclamationWindow?: number } = {}
): Promise<ScreenedProvider[]> {
  const { screening } = deriveResources(sdl);
  const data = unwrap(
    await client.POST("/v1/bid-screening", {
      body: {
        requirements: buildRequirements(sdl),
        resources: screening,
        timezone: systemTimezone(),
        ...(opts.reclamationWindow !== undefined ? { reclamationWindow: opts.reclamationWindow } : {})
      }
    })
  );
  return data.providers ?? [];
}

/** Extract placement attributes + auditor requirements from an SDL for the screening `requirements`. */
export function buildRequirements(sdl: SdlDoc): ScreenRequirements {
  const attributes: Array<{ key: string; value: string }> = [];
  let signedBy: { anyOf: string[]; allOf: string[] } | undefined;

  for (const placement of Object.values(sdl.profiles?.placement ?? {})) {
    for (const [key, value] of Object.entries(placement.attributes ?? {})) {
      attributes.push({ key, value: String(value) });
    }
    if (!signedBy && placement.signedBy) {
      signedBy = { anyOf: placement.signedBy.anyOf ?? [], allOf: placement.signedBy.allOf ?? [] };
    }
  }

  const req: ScreenRequirements = {};
  if (signedBy) req.signedBy = signedBy;
  if (attributes.length > 0) req.attributes = attributes;
  return req;
}

export function systemTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Summarize a provider's rolling 7-day incident window into a single downtime figure + open flag. */
export function summarizeIncidents(incidents: Incident[] = []): { downtime7d: string; openIncident: boolean } {
  const totalSeconds = incidents.reduce((sum, i) => sum + (i.downtimeSeconds ?? 0), 0);
  const openIncident = incidents.some((i) => i.hasOpenIncident);
  return { downtime7d: humanDuration(totalSeconds), openIncident };
}

function humanDuration(seconds: number): string {
  if (seconds <= 0) return "0s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 && h === 0) parts.push(`${s}s`);
  return parts.join(" ") || "0s";
}
