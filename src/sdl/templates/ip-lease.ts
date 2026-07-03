import { computeResources, DEFAULT_PRICE, deploymentMap, placement } from "./common.js";
import type { InitOptions, SdlTemplate } from "./types.js";

/** Service with a dedicated public IP (endpoints + expose ... to ip). */
export const ipLeaseTemplate: SdlTemplate = {
  name: "ip-lease",
  description: "Service with a dedicated public IP (endpoints + expose to ip).",
  params: ["--image", "--port", "--as", "--cpu", "--memory", "--storage", "--count", "--price", "--env"],
  build(o: InitOptions): Record<string, unknown> {
    const name = o.name ?? "web";
    const endpoint = "appip";
    const port = o.port ?? 80;
    const as = o.as ?? 80;

    const service: Record<string, unknown> = { image: o.image ?? "nginx:1.27" };
    if (o.env?.length) service.env = o.env;
    service.expose = [{ port, as, to: [{ global: true, ip: endpoint }] }];

    return {
      version: "2.1",
      endpoints: { [endpoint]: { kind: "ip" } },
      services: { [name]: service },
      profiles: {
        compute: { [name]: { resources: computeResources(o, { cpu: "0.5", memory: "512Mi", storage: "512Mi" }) } },
        placement: placement([name], o.price ?? DEFAULT_PRICE)
      },
      deployment: deploymentMap(name, name, o.count ?? 1)
    };
  }
};
