import { gpuTemplate } from "./gpu.js";
import { ipLeaseTemplate } from "./ip-lease.js";
import { multiServiceTemplate } from "./multi-service.js";
import type { SdlTemplate } from "./types.js";
import { webTemplate } from "./web.js";

/**
 * The scaffold registry. Add a template by writing a new module that exports an
 * SdlTemplate and appending it here — nothing else needs to change.
 */
export const templates: SdlTemplate[] = [webTemplate, gpuTemplate, multiServiceTemplate, ipLeaseTemplate];

const byName = new Map(templates.map((t) => [t.name, t]));

export function listTemplates(): SdlTemplate[] {
  return templates;
}

export function getTemplate(name: string): SdlTemplate | undefined {
  return byName.get(name);
}

export function templateNames(): string[] {
  return templates.map((t) => t.name);
}
