import { AxiError } from "../errors.js";
import { toYaml } from "./serialize.js";
import { getTemplate } from "./templates/registry.js";
import type { InitOptions } from "./templates/types.js";
import type { SdlDoc } from "./types.js";
import { validateSdl } from "./validate.js";

/** Build a throwaway SDL from resource flags (via a template) so chain-sdk does the unit math. */
export function synthesizeSdl(o: InitOptions): SdlDoc {
  const templateName = o.gpu !== undefined || o.gpuModel !== undefined ? "gpu" : "web";
  const template = getTemplate(templateName);
  if (!template) throw new AxiError({ code: "internal", message: `Missing "${templateName}" template.` });
  const { valid, errors, parsed } = validateSdl(toYaml(template.build(o)));
  if (!valid || !parsed) {
    throw new AxiError({
      code: "internal",
      message: `Synthesized SDL failed validation: ${errors.map((e) => e.message).join("; ")}`
    });
  }
  return parsed;
}
