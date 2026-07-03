import { computeResources, DEFAULT_PRICE, placement } from "./common.js";
import type { InitOptions, SdlTemplate } from "./types.js";

/**
 * Two services — a public `app` plus a `db` with a persistent volume and
 * internal-only networking. A starting point the agent edits (images, env, sizes).
 */
export const multiServiceTemplate: SdlTemplate = {
  name: "multi-service",
  description: "App + database with a persistent volume and service-to-service networking.",
  params: ["--image", "--port", "--as", "--cpu", "--memory", "--storage", "--count", "--price", "--env"],
  build(o: InitOptions): Record<string, unknown> {
    const port = o.port ?? 80;
    const as = o.as ?? 80;

    const app: Record<string, unknown> = { image: o.image ?? "nginx:1.27", dependencies: [{ service: "db" }] };
    if (o.env?.length) app.env = o.env;
    app.expose = [{ port, as, to: [{ global: true }] }];

    const db: Record<string, unknown> = {
      image: "postgres:16",
      env: ["POSTGRES_PASSWORD=changeme", "POSTGRES_USER=app", "POSTGRES_DB=app"],
      expose: [{ port: 5432, to: [{ service: "app" }] }],
      params: { storage: { "db-data": { mount: "/var/lib/postgresql/data", readOnly: false } } }
    };

    return {
      version: "2.0",
      services: { app, db },
      profiles: {
        compute: {
          app: { resources: computeResources(o, { cpu: "0.5", memory: "512Mi", storage: "512Mi" }) },
          db: {
            resources: {
              cpu: { units: 0.5 },
              memory: { size: "1Gi" },
              storage: [
                { size: "1Gi" },
                { name: "db-data", size: o.storage ?? "10Gi", attributes: { persistent: true, class: "beta2" } }
              ]
            }
          }
        },
        placement: placement(["app", "db"], o.price ?? DEFAULT_PRICE)
      },
      deployment: {
        app: { dcloud: { profile: "app", count: o.count ?? 1 } },
        db: { dcloud: { profile: "db", count: 1 } }
      }
    };
  }
};
