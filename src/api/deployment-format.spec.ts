import { describe, expect, it } from "vitest";

import { collectUris, formatServiceUris, isDeploymentReady, type RawLease } from "./deployment-format.js";

describe("deployment formatting", () => {
  it("treats null service uris as no external uris", () => {
    const leases = [
      {
        id: {
          owner: "akash1owner",
          dseq: "1",
          gseq: 1,
          oseq: 1,
          provider: "akash1provider",
          bseq: 0
        },
        state: "active",
        price: { denom: "uact", amount: "3.000000000000000000" },
        status: {
          services: {
            app: {
              name: "app",
              available: 1,
              total: 1,
              uris: ["app.example.com"],
              replicas: 1,
              ready_replicas: 1
            },
            db: {
              name: "db",
              available: 1,
              total: 1,
              uris: null,
              replicas: 1,
              ready_replicas: 1
            }
          },
          forwarded_ports: null,
          ips: null
        }
      }
    ] satisfies RawLease[];

    expect(isDeploymentReady(leases)).toBe(true);
    expect(collectUris(leases)).toEqual(["app.example.com"]);
    expect(formatServiceUris(leases[0]?.status?.services.db?.uris)).toBe("-");
  });
});
