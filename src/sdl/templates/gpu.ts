import { computeResources, deploymentMap, placement } from "./common.js";
import type { InitOptions, SdlTemplate } from "./types.js";

const GPU_DEFAULT_PRICE = 100000; // uact/block — GPU compute is priced higher

/** GPU workload (ML / inference) with an nvidia model requirement. */
export const gpuTemplate: SdlTemplate = {
  name: "gpu",
  description: "GPU workload (ML/inference) with an nvidia model requirement.",
  params: ["--image", "--gpu", "--gpu-model", "--port", "--as", "--cpu", "--memory", "--storage", "--count", "--price", "--env"],
  build(o: InitOptions): Record<string, unknown> {
    const name = o.name ?? "app";
    const port = o.port ?? 8080;
    const as = o.as ?? 80;

    const service: Record<string, unknown> = {
      image: o.image ?? "pytorch/pytorch:2.2.0-cuda12.1-cudnn8-runtime"
    };
    if (o.env?.length) service.env = o.env;
    service.expose = [{ port, as, to: [{ global: true }] }];

    const resources = computeResources(o, { cpu: "4", memory: "16Gi", storage: "50Gi" });
    resources.gpu = {
      units: o.gpu ?? 1,
      attributes: { vendor: { nvidia: [{ model: o.gpuModel ?? "a100" }] } }
    };

    return {
      version: "2.0",
      services: { [name]: service },
      profiles: {
        compute: { [name]: { resources } },
        placement: placement([name], o.price ?? GPU_DEFAULT_PRICE)
      },
      deployment: deploymentMap(name, name, o.count ?? 1)
    };
  }
};
