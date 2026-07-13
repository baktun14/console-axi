import { formatUsd } from "../output/price.js";
import type { paths } from "./schema.js";

export type GpuPricesBody = paths["/v1/gpu-prices"]["get"]["responses"][200]["content"]["application/json"];
export type GpuModel = GpuPricesBody["models"][number];

export interface GpuFilters {
  vendor?: string;
  model?: string;
  available?: boolean;
}

export function filterGpuModels(models: GpuModel[], filters: GpuFilters): GpuModel[] {
  const vendor = filters.vendor?.toLowerCase();
  const model = filters.model?.toLowerCase();
  return models.filter((m) => {
    if (vendor && !m.vendor.toLowerCase().includes(vendor)) return false;
    if (model && !m.model.toLowerCase().includes(model)) return false;
    if (filters.available && m.availability.available <= 0) return false;
    return true;
  });
}

export function sortGpuModels(models: GpuModel[]): GpuModel[] {
  return [...models].sort(
    (a, b) => b.availability.available - a.availability.available || a.model.localeCompare(b.model)
  );
}

/** One compact table row per GPU model. Prices are hourly (verified live). */
export function gpuRow(m: GpuModel): Record<string, string> {
  return {
    vendor: m.vendor,
    model: m.model,
    ram: m.ram,
    interface: m.interface,
    available: `${m.availability.available}/${m.availability.total}`,
    providers: `${m.providerAvailability.available}/${m.providerAvailability.total}`,
    minHr: m.price ? formatUsd(m.price.min) : "-",
    medHr: m.price ? formatUsd(m.price.med) : "-",
    maxHr: m.price ? formatUsd(m.price.max) : "-"
  };
}
