import { blockPriceToUsdPerMonth, formatUsd, rawAmount, uactToUsd } from "../output/price.js";

/** A lease as returned inside a deployment list/detail entry. */
export interface RawLease {
  id: { owner: string; dseq: string; gseq: number; oseq: number; provider: string; bseq: number };
  state: string;
  price: { denom: string; amount: string };
  status?: LeaseStatus | null;
}

export interface LeaseStatus {
  services: Record<string, ServiceStatus>;
  forwarded_ports: Record<string, Array<{ port: number; externalPort: number; host?: string }>> | null;
  ips: Record<string, Array<{ IP: string; ExternalPort: number; Protocol: string }>> | null;
}

export interface ServiceStatus {
  name: string;
  uris: string[] | null;
  replicas: number;
  ready_replicas: number;
  available: number;
  total: number;
}

export interface RawDeploymentEntry {
  deployment: { id: { owner: string; dseq: string }; state: string; created_at: string };
  leases?: RawLease[];
}

/** One compact row for a deployment list / home view. */
export function summarizeDeployment(entry: RawDeploymentEntry): {
  dseq: string;
  state: string;
  provider: string;
  cost: string;
} {
  const leases = entry.leases ?? [];
  const totalPerBlock = leases.reduce((sum, l) => sum + rawAmount(l.price.amount), 0);
  const provider = leases[0]?.id.provider ?? "-";
  return {
    dseq: entry.deployment.id.dseq,
    state: entry.deployment.state,
    provider: leases.length > 1 ? `${provider} (+${leases.length - 1})` : provider,
    cost: leases.length > 0 ? blockPriceToUsdPerMonth(totalPerBlock) : "-"
  };
}

/** All service URIs across a deployment's leases, flattened. */
export function collectUris(leases: RawLease[]): string[] {
  const uris: string[] = [];
  for (const lease of leases) {
    const services = lease.status?.services ?? {};
    for (const svc of Object.values(services)) {
      uris.push(...serviceUris(svc.uris));
    }
  }
  return uris;
}

export function formatServiceUris(uris: string[] | null | undefined): string {
  const externalUris = serviceUris(uris);
  return externalUris.length > 0 ? externalUris.join(" ") : "-";
}

/** Whether every service in every lease has at least one ready replica. */
export function isDeploymentReady(leases: RawLease[]): boolean {
  const services = leases.flatMap((l) => Object.values(l.status?.services ?? {}));
  if (services.length === 0) return false;
  return services.every((s) => s.ready_replicas > 0);
}

/** The deployment-detail fields statusSnapshot consumes (subset of GET /v1/deployments/{dseq}). */
export interface DeploymentDetailLike {
  deployment: { id: { owner: string; dseq: string }; state: string; created_at: string };
  leases?: RawLease[];
}

export interface StatusSnapshot {
  result: Record<string, unknown>;
  ready: boolean;
  state: string;
}

/** Build the `deployment status` body (shared by the one-shot command and --watch). */
export function statusSnapshot(dseq: string, consoleUrl: string, data: DeploymentDetailLike): StatusSnapshot {
  const leases = data.leases ?? [];
  const ready = isDeploymentReady(leases);

  const services = leases.flatMap((lease) =>
    Object.values(lease.status?.services ?? {}).map((svc) => ({
      service: svc.name,
      ready: `${svc.ready_replicas}/${svc.replicas}`,
      uris: formatServiceUris(svc.uris)
    }))
  );

  const ports = leases.flatMap((lease) =>
    Object.entries(lease.status?.forwarded_ports ?? {}).flatMap(([service, list]) =>
      list.map((p) => ({ service, port: p.port, externalPort: p.externalPort, host: p.host ?? "-" }))
    )
  );

  const result: Record<string, unknown> = {
    dseq,
    console: consoleUrl,
    state: data.deployment.state,
    ready,
    services: services.length > 0 ? services : "0 services reporting yet"
  };
  if (ports.length > 0) result.forwardedPorts = ports;

  return { result, ready, state: data.deployment.state };
}

export type WatchOutcome = "ready" | "closed" | "pending";

/** Terminal conditions for `deployment status --watch`. */
export function watchOutcome(state: string, ready: boolean): WatchOutcome {
  if (ready) return "ready";
  if (state === "closed") return "closed";
  return "pending";
}

export { formatUsd, uactToUsd };

function serviceUris(uris: string[] | null | undefined): string[] {
  return uris ?? [];
}
