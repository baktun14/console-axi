import type { InitOptions } from "./types.js";

export const DEFAULT_PRICE = 10000; // uact/block — a generous ceiling so bids arrive

/** SDL cpu units accept a number (0.5, 2) or a millicore string ("500m"). Keep numeric strings numeric. */
export function cpuUnits(value: string): number | string {
  return /^\d+(\.\d+)?$/.test(value) ? Number(value) : value;
}

export interface ResourceDefaults {
  cpu: string;
  memory: string;
  storage: string;
}

/** Simple (single ephemeral volume) compute resources from options + per-template defaults. */
export function computeResources(o: InitOptions, d: ResourceDefaults): Record<string, unknown> {
  return {
    cpu: { units: cpuUnits(o.cpu ?? d.cpu) },
    memory: { size: o.memory ?? d.memory },
    storage: { size: o.storage ?? d.storage }
  };
}

/** A `profiles.placement` block that prices every given compute profile at the same ceiling. */
export function placement(profileNames: string[], price: number): Record<string, unknown> {
  const pricing: Record<string, { denom: string; amount: number }> = {};
  for (const name of profileNames) pricing[name] = { denom: "uact", amount: price };
  return { dcloud: { pricing } };
}

/** A single `deployment.<service>.<placement>` mapping. */
export function deploymentMap(service: string, profile: string, count: number): Record<string, unknown> {
  return { [service]: { dcloud: { profile, count } } };
}
