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
  forwarded_ports: Record<string, Array<{ port: number; externalPort: number; host?: string }>>;
  ips: Record<string, Array<{ IP: string; ExternalPort: number; Protocol: string }>>;
}

export interface ServiceStatus {
  name: string;
  uris: string[];
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
      uris.push(...svc.uris);
    }
  }
  return uris;
}

/** Whether every service in every lease has at least one ready replica. */
export function isDeploymentReady(leases: RawLease[]): boolean {
  const services = leases.flatMap((l) => Object.values(l.status?.services ?? {}));
  if (services.length === 0) return false;
  return services.every((s) => s.ready_replicas > 0);
}

export { formatUsd, uactToUsd };
