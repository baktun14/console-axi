import type { ApiClient } from "../api/client.js";
import { unwrap } from "../api/client.js";
import type { RawLease } from "../api/deployment-format.js";
import { AxiError } from "../errors.js";

/** Everything needed to address a provider endpoint for one lease. */
export interface LeaseTarget {
  dseq: string;
  gseq: number;
  oseq: number;
  provider: string;
  hostUri: string;
}

const hostUriCache = new Map<string, string>();

/** Resolve a provider's proxy host URI (memoized per process). */
export async function resolveHostUri(client: ApiClient, providerAddress: string): Promise<string> {
  const cached = hostUriCache.get(providerAddress);
  if (cached) return cached;
  const provider = unwrap(await client.GET("/v1/providers/{address}", { params: { path: { address: providerAddress } } }));
  const hostUri = (provider as { hostUri?: string }).hostUri;
  if (!hostUri) {
    throw new AxiError({ code: "not_found", message: `Provider ${providerAddress} has no hostUri.` });
  }
  hostUriCache.set(providerAddress, hostUri);
  return hostUri;
}

/**
 * Resolve the provider-facing target for a deployment. Picks the lease matching
 * `provider` if given, else the first lease with a provider. Errors if the
 * deployment has no active lease yet.
 */
export async function resolveLeaseTarget(
  client: ApiClient,
  dseq: string,
  options: { provider?: string } = {}
): Promise<LeaseTarget> {
  const data = unwrap(await client.GET("/v1/deployments/{dseq}", { params: { path: { dseq } } }), { dseq }).data;
  const leases = (data.leases ?? []) as RawLease[];
  const candidates = leases.filter((l) => l.id.provider);
  const lease = options.provider ? candidates.find((l) => l.id.provider === options.provider) : candidates[0];

  if (!lease) {
    throw new AxiError({
      code: "not_found",
      message:
        candidates.length === 0
          ? `Deployment ${dseq} has no lease yet. Accept a bid first.`
          : `No lease found for provider ${options.provider} on deployment ${dseq}.`,
      details: { dseq },
      help: [`console-axi bid list --dseq ${dseq}`, `console-axi deployment status ${dseq}`]
    });
  }

  const hostUri = await resolveHostUri(client, lease.id.provider);
  return { dseq, gseq: lease.id.gseq, oseq: lease.id.oseq, provider: lease.id.provider, hostUri };
}

/** Build a provider lease endpoint URL (logs / kubeevents / shell). */
export function providerLeaseUrl(target: LeaseTarget, type: "logs" | "events" | "shell"): string {
  const suffix = type === "events" ? "kubeevents" : type;
  return `${target.hostUri}/lease/${target.dseq}/${target.gseq}/${target.oseq}/${suffix}`;
}
