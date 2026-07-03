import { blockPriceToUsdPerMonth } from "../output/price.js";
import type { SdlComputeResources, SdlDoc, SdlExpose } from "./types.js";

export interface SdlServiceSummary {
  name: string;
  image: string;
  resources: string;
  exposed: string;
  count: number;
}

export interface SdlSummary {
  version: string;
  services: SdlServiceSummary[];
  /** Ceiling implied by the placement pricing (max the deployer would pay), not the actual bid. */
  maxMonthlyCost: string;
}

/** Build a human-readable overview of a (valid) SDL for the `sdl validate` success output. */
export function summarizeSdl(sdl: SdlDoc): SdlSummary {
  const services: SdlServiceSummary[] = [];
  let totalPerBlock = 0;

  for (const [name, svc] of Object.entries(sdl.services ?? {})) {
    const target = firstTarget(sdl, name);
    const profileName = target?.profile ?? name;
    const count = target?.count ?? 1;
    const resources = sdl.profiles?.compute?.[profileName]?.resources;

    services.push({
      name,
      image: svc.image ?? "(none)",
      resources: describeResources(resources),
      exposed: describeExpose(svc.expose),
      count
    });

    const amount = priceAmount(sdl, name);
    if (amount !== undefined) totalPerBlock += amount * count;
  }

  return {
    version: sdl.version ?? "(unset)",
    services,
    maxMonthlyCost: totalPerBlock > 0 ? blockPriceToUsdPerMonth(totalPerBlock) : "n/a"
  };
}

function firstTarget(sdl: SdlDoc, service: string) {
  const placements = sdl.deployment?.[service];
  if (!placements) return undefined;
  const first = Object.values(placements)[0];
  return first;
}

function priceAmount(sdl: SdlDoc, service: string): number | undefined {
  const placements = sdl.deployment?.[service];
  if (!placements) return undefined;
  const [placementName, target] = Object.entries(placements)[0] ?? [];
  if (!placementName || !target?.profile) return undefined;
  const raw = sdl.profiles?.placement?.[placementName]?.pricing?.[target.profile]?.amount;
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function describeResources(r: SdlComputeResources | undefined): string {
  if (!r) return "unspecified";
  const parts: string[] = [];
  if (r.cpu?.units !== undefined) parts.push(`${r.cpu.units} cpu`);
  if (r.memory?.size) parts.push(`${r.memory.size} ram`);
  const storage = describeStorage(r.storage);
  if (storage) parts.push(`${storage} storage`);
  if (r.gpu?.units) {
    const model = r.gpu.attributes?.vendor?.nvidia?.[0]?.model;
    parts.push(`${r.gpu.units} gpu${model ? ` (${model})` : ""}`);
  }
  return parts.join(", ") || "unspecified";
}

function describeStorage(storage: SdlComputeResources["storage"]): string | undefined {
  if (!storage) return undefined;
  if (Array.isArray(storage)) {
    return storage.map((v) => v.size).filter(Boolean).join("+");
  }
  return storage.size;
}

function describeExpose(expose: SdlExpose[] | undefined): string {
  if (!expose || expose.length === 0) return "internal only";
  const parts = expose.map((e) => {
    const port = e.as ?? e.port;
    const target = (e.to ?? [])
      .map((t) => (t.global ? "global" : t.ip ? `ip:${t.ip}` : t.service ? `svc:${t.service}` : "?"))
      .join("/");
    return `${port}->${target || "internal"}`;
  });
  return parts.join(", ");
}
