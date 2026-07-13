import type { ScreeningResource } from "./resources.js";

/** Totals for POST /v1/pricing: cpu in millicores, memory/storage in bytes. */
export interface AggregateSpec {
  cpu: number;
  memory: number;
  storage: number;
}

/** Sum every service's resources × replica count into one pricing spec. */
export function aggregateSpec(resources: ScreeningResource[]): AggregateSpec {
  const spec: AggregateSpec = { cpu: 0, memory: 0, storage: 0 };
  for (const { resource, count } of resources) {
    spec.cpu += Number(resource.cpu.units.val) * count;
    spec.memory += Number(resource.memory.quantity.val) * count;
    spec.storage += resource.storage.reduce((sum, s) => sum + Number(s.quantity.val), 0) * count;
  }
  return spec;
}

/** /v1/pricing cannot price GPUs — callers must disclaim when this is true. */
export function hasGpu(resources: ScreeningResource[]): boolean {
  return resources.some(({ resource }) => Number(resource.gpu.units.val) > 0);
}
