import { describe, expect, it } from "vitest";

import { toYaml } from "../serialize.js";
import { validateSdl } from "../validate.js";
import { getTemplate, listTemplates, templateNames } from "./registry.js";

describe("template registry", () => {
  it("exposes the four v1 templates", () => {
    expect(templateNames()).toEqual(["web", "gpu", "multi-service", "ip-lease"]);
  });

  it.each(listTemplates().map((t) => t.name))("template %s generates valid SDL with defaults", (name) => {
    const template = getTemplate(name)!;
    const yaml = toYaml(template.build({}));
    const result = validateSdl(yaml);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("applies user options (image, count, env) to the generated SDL", () => {
    const yaml = toYaml(getTemplate("web")!.build({ image: "caddy:2.7", count: 3, env: ["FOO=bar"] }));
    const { valid, parsed } = validateSdl(yaml);
    expect(valid).toBe(true);
    expect(parsed?.services?.web?.image).toBe("caddy:2.7");
    expect(parsed?.services?.web?.env).toEqual(["FOO=bar"]);
    expect(parsed?.deployment?.web?.dcloud?.count).toBe(3);
  });

  it("serializes version as a quoted string, not a float", () => {
    const yaml = toYaml(getTemplate("web")!.build({}));
    expect(yaml).toMatch(/version: "2\.0"/);
  });

  it("gpu template pins a non-latest image and requires an nvidia model", () => {
    const yaml = toYaml(getTemplate("gpu")!.build({ gpuModel: "h100" }));
    const { valid } = validateSdl(yaml);
    expect(valid).toBe(true);
    expect(yaml).toContain("model: h100");
    expect(yaml).not.toMatch(/image:.*:latest/);
  });
});
