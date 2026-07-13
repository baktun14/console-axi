import type { paths } from "./schema.js";

export type ProviderListItem = paths["/v1/providers"]["get"]["responses"][200]["content"]["application/json"][number];
export type ProviderGpu = ProviderListItem["gpuModels"][number];

export interface ProviderFilters {
  gpuModel?: string;
  region?: string;
  audited?: boolean;
  /** Include offline providers (default: online only). */
  all?: boolean;
}

export function filterProviders(list: ProviderListItem[], filters: ProviderFilters): ProviderListItem[] {
  const gpuModel = filters.gpuModel?.toLowerCase();
  const region = filters.region?.toLowerCase();
  return list.filter((p) => {
    if (!filters.all && !p.isOnline) return false;
    if (filters.audited && !p.isAudited) return false;
    if (gpuModel && !p.gpuModels.some((g) => g.model.toLowerCase().includes(gpuModel))) return false;
    if (region) {
      const haystack = [p.locationRegion, p.ipRegionCode, p.ipRegion].filter(Boolean).map((v) => String(v).toLowerCase());
      if (!haystack.some((v) => v.includes(region))) return false;
    }
    return true;
  });
}

export function sortProviders(list: ProviderListItem[]): ProviderListItem[] {
  return [...list].sort(
    (a, b) => (b.uptime30d ?? -1) - (a.uptime30d ?? -1) || (b.leaseCount ?? 0) - (a.leaseCount ?? 0)
  );
}

/** Uptime is a 0-1 fraction from the API (verified live); render as a percentage. */
export function formatUptime(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined) return "-";
  const pct = fraction * 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
}

/** Dedupe a provider's GPU inventory: "h100 x2, a100". */
export function gpuSummary(models: ProviderGpu[]): string {
  if (models.length === 0) return "-";
  const counts = new Map<string, number>();
  for (const m of models) counts.set(m.model, (counts.get(m.model) ?? 0) + 1);
  return [...counts.entries()].map(([model, n]) => (n > 1 ? `${model} x${n}` : model)).join(", ");
}

/** One compact table row per provider. */
export function providerRow(p: ProviderListItem): Record<string, unknown> {
  return {
    owner: p.owner,
    org: p.organization ?? p.name ?? "-",
    region: p.locationRegion ?? p.ipRegionCode ?? p.ipRegion ?? "-",
    uptime7d: formatUptime(p.uptime7d),
    audited: p.isAudited,
    leases: p.leaseCount ?? 0,
    gpus: gpuSummary(p.gpuModels)
  };
}
