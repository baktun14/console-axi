import { generateManifest } from "@akashnetwork/chain-sdk";

import { AxiError } from "../errors.js";
import type { SdlDoc } from "./types.js";

/** Aggregate spec for POST /v1/pricing (cpu in thousandths of a core, bytes elsewhere). */
export interface PricingSpec {
  cpu: number;
  memory: number;
  storage: number;
}

interface ResourceAttribute {
  key: string;
  value: string;
}

/** One resource group for POST /v1/bid-screening (`resources[]`). */
export interface ScreeningResource {
  resource: {
    id: number;
    cpu: { units: { val: string }; attributes: ResourceAttribute[] };
    memory: { quantity: { val: string }; attributes: ResourceAttribute[] };
    gpu: { units: { val: string }; attributes: ResourceAttribute[] };
    storage: Array<{ name: string; quantity: { val: string }; attributes: ResourceAttribute[] }>;
  };
  count: number;
  price: { denom: string; amount: string };
}

export interface DerivedResources {
  pricing: PricingSpec;
  screening: ScreeningResource[];
}

// Minimal view of chain-sdk's generateManifest output (resource `val`s are Uint8Arrays
// holding the ASCII decimal string, e.g. "500" for 0.5 core).
interface ManifestQuantity {
  val: unknown;
}
interface ManifestResource {
  id?: number;
  cpu: { units: ManifestQuantity; attributes?: ResourceAttribute[] };
  memory: { quantity: ManifestQuantity; attributes?: ResourceAttribute[] };
  gpu: { units: ManifestQuantity; attributes?: ResourceAttribute[] };
  storage: Array<{ name: string; quantity: ManifestQuantity; attributes?: ResourceAttribute[] }>;
}
interface ManifestResult {
  ok?: boolean;
  value?: { groups: Array<{ name: string; services: Array<{ name: string; resources: ManifestResource }> }> };
}

const decoder = new TextDecoder();

/** Decode a chain-sdk resource `val` (Uint8Array, or JSON-revived byte map) to its decimal string. */
function decodeVal(val: unknown): string {
  if (val instanceof Uint8Array) return decoder.decode(val);
  if (typeof val === "string") return val;
  if (typeof val === "number") return String(val);
  if (val && typeof val === "object") {
    const bytes = Object.values(val as Record<string, number>);
    return decoder.decode(Uint8Array.from(bytes));
  }
  return "0";
}

/**
 * Derive pricing + bid-screening request inputs from a parsed SDL by running
 * chain-sdk's manifest generator (which does the unit math), then attaching the
 * per-service replica count and price from the SDL.
 */
export function deriveResources(sdl: SdlDoc): DerivedResources {
  let result: ManifestResult;
  try {
    result = generateManifest(sdl as never) as ManifestResult;
  } catch (e) {
    throw manifestError(e instanceof Error ? e.message : String(e));
  }
  if (!result || result.ok === false || !result.value) {
    throw manifestError("manifest generation returned no result");
  }

  const screening: ScreeningResource[] = [];
  let cpu = 0;
  let memory = 0;
  let storage = 0;

  for (const group of result.value.groups ?? []) {
    for (const svc of group.services ?? []) {
      const r = svc.resources;
      const count = countFor(sdl, svc.name, group.name);
      const price = priceFor(sdl, svc.name, group.name);

      const cpuVal = Number(decodeVal(r.cpu.units.val)) || 0;
      const memVal = Number(decodeVal(r.memory.quantity.val)) || 0;
      const storageVals = (r.storage ?? []).map((s) => Number(decodeVal(s.quantity.val)) || 0);
      const storageTotal = storageVals.reduce((a, b) => a + b, 0);

      cpu += cpuVal * count;
      memory += memVal * count;
      storage += storageTotal * count;

      screening.push({
        resource: {
          id: r.id ?? 1,
          cpu: { units: { val: decodeVal(r.cpu.units.val) }, attributes: r.cpu.attributes ?? [] },
          memory: { quantity: { val: decodeVal(r.memory.quantity.val) }, attributes: r.memory.attributes ?? [] },
          gpu: { units: { val: decodeVal(r.gpu.units.val) }, attributes: r.gpu.attributes ?? [] },
          storage: (r.storage ?? []).map((s) => ({
            name: s.name,
            quantity: { val: decodeVal(s.quantity.val) },
            attributes: s.attributes ?? []
          }))
        },
        count,
        price
      });
    }
  }

  return { pricing: { cpu, memory, storage }, screening };
}

function manifestError(reason: string): AxiError {
  return new AxiError({
    code: "usage",
    message: `Could not derive resources from the SDL (${reason}).`,
    help: ["console-axi sdl validate <file>"]
  });
}

function countFor(sdl: SdlDoc, service: string, placement: string): number {
  const count = sdl.deployment?.[service]?.[placement]?.count;
  return typeof count === "number" && count > 0 ? count : 1;
}

function priceFor(sdl: SdlDoc, service: string, placement: string): { denom: string; amount: string } {
  const profile = sdl.deployment?.[service]?.[placement]?.profile;
  const pricing = profile ? sdl.profiles?.placement?.[placement]?.pricing?.[profile] : undefined;
  return { denom: pricing?.denom ?? "uact", amount: String(pricing?.amount ?? "0") };
}
