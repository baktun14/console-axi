import { describe, expect, it } from "vitest";

import {
  collectUris,
  formatServiceUris,
  isDeploymentReady,
  type RawLease,
  statusSnapshot,
  watchOutcome
} from "./deployment-format.js";

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

  describe("statusSnapshot", () => {
    const lease = (ready: boolean): RawLease => ({
      id: { owner: "o", dseq: "42", gseq: 1, oseq: 1, provider: "akash1p", bseq: 0 },
      state: "active",
      price: { denom: "uact", amount: "1.6" },
      status: {
        services: {
          web: {
            name: "web",
            available: ready ? 1 : 0,
            total: 1,
            uris: ["web.example.com"],
            replicas: 1,
            ready_replicas: ready ? 1 : 0
          }
        },
        forwarded_ports: { web: [{ port: 80, externalPort: 30080 }] },
        ips: null
      }
    });

    it("maps services, readiness and forwarded ports", () => {
      const snapshot = statusSnapshot("42", "https://console/d/42", {
        deployment: { id: { owner: "o", dseq: "42" }, state: "active", created_at: "1" },
        leases: [lease(true)]
      });

      expect(snapshot.ready).toBe(true);
      expect(snapshot.state).toBe("active");
      expect(snapshot.result).toMatchObject({
        dseq: "42",
        state: "active",
        ready: true,
        services: [{ service: "web", ready: "1/1", uris: "web.example.com" }],
        forwardedPorts: [{ service: "web", port: 80, externalPort: 30080, host: "-" }]
      });
    });

    it("reports zero services when nothing is deployed yet", () => {
      const snapshot = statusSnapshot("42", "url", {
        deployment: { id: { owner: "o", dseq: "42" }, state: "active", created_at: "1" },
        leases: []
      });

      expect(snapshot.ready).toBe(false);
      expect(snapshot.result.services).toBe("0 services reporting yet");
    });
  });

  describe("watchOutcome", () => {
    it("is ready when the deployment reports ready", () => {
      expect(watchOutcome("active", true)).toBe("ready");
    });

    it("is closed for closed deployments (can never become ready)", () => {
      expect(watchOutcome("closed", false)).toBe("closed");
    });

    it("keeps polling otherwise", () => {
      expect(watchOutcome("active", false)).toBe("pending");
    });
  });
});
