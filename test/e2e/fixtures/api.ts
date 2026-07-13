import type { paths } from "../../../src/api/schema.js";

/**
 * Hand-written fixtures typed with `satisfies` against the generated OpenAPI
 * schema: when `npm run gen:api` changes a response shape, drifted fixtures
 * fail `npm run typecheck` — contract coverage without extra tooling.
 */

type Body<P extends keyof paths, M extends "get" | "post", S extends number> = paths[P] extends {
  [K in M]: { responses: { [Code in S]: { content: { "application/json": infer B } } } };
}
  ? B
  : never;

export const USER = {
  data: {
    id: "user-uuid-1",
    userId: "auth0|123",
    username: "max",
    email: "max@example.com",
    emailVerified: true,
    subscribedToNewsletter: false
  }
} satisfies Body<"/v1/user/me", "get", 200>;

export const BALANCES = {
  data: {
    balance: 25_500_000, // $25.50 available
    deployments: 4_500_000, // $4.50 locked in escrow
    total: 30_000_000 // $30.00
  }
} satisfies Body<"/v1/balances", "get", 200>;

export const JWT = {
  data: {
    // Realistic three-part shape so redaction/rotation code paths see a real JWT.
    token: "eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiJha2FzaDEifQ.c2lnbmF0dXJl"
  }
} satisfies Body<"/v1/create-jwt-token", "post", 201>;

export function createdDeployment(dseq: string): Body<"/v1/deployments", "post", 201> {
  return {
    data: {
      dseq,
      manifest: JSON.stringify([{ name: "dcloud", services: [{ name: "web" }] }]),
      signTx: { code: 0, transactionHash: "TX123ABC", rawLog: "" }
    }
  };
}

type GetDeploymentBody = Body<"/v1/deployments/{dseq}", "get", 200>;
type DetailLease = GetDeploymentBody["data"]["leases"][number];
type Escrow = GetDeploymentBody["data"]["escrow_account"];

export const PROVIDER_ADDRESS = "akash1provideraaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function escrow(fundsUact: string, transferredUact: string): Escrow {
  return {
    id: { scope: "deployment", xid: "akash1owner/1234" },
    state: {
      owner: "akash1owneraaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      state: "open",
      transferred: [{ denom: "uact", amount: transferredUact }],
      settled_at: "1000000",
      funds: [{ denom: "uact", amount: fundsUact }],
      deposits: [
        {
          owner: "akash1owneraaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          height: "999999",
          source: "balance",
          balance: { denom: "uact", amount: fundsUact }
        }
      ]
    }
  };
}

export interface LeaseOptions {
  dseq: string;
  ready?: boolean;
  uris?: string[];
  provider?: string;
  withStatus?: boolean;
  forwardedPorts?: boolean;
}

function detailLease(opts: LeaseOptions): DetailLease {
  const ready = opts.ready ?? true;
  return {
    id: {
      owner: "akash1owneraaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      dseq: opts.dseq,
      gseq: 1,
      oseq: 1,
      provider: opts.provider ?? PROVIDER_ADDRESS,
      bseq: 1
    },
    state: "active",
    price: { denom: "uact", amount: "1.6" },
    created_at: "1000001",
    closed_on: "",
    status:
      opts.withStatus === false
        ? null
        : {
            forwarded_ports: opts.forwardedPorts
              ? { web: [{ port: 80, externalPort: 30080, host: "provider.example.com" }] }
              : {},
            ips: {},
            services: {
              web: {
                name: "web",
                available: ready ? 1 : 0,
                total: 1,
                uris: opts.uris ?? ["web.example.com"],
                observed_generation: 1,
                replicas: 1,
                updated_replicas: 1,
                ready_replicas: ready ? 1 : 0,
                available_replicas: ready ? 1 : 0
              }
            }
          }
  };
}

export function deploymentDetail(
  opts: LeaseOptions & { state?: string; leases?: number }
): GetDeploymentBody {
  const leaseCount = opts.leases ?? 1;
  return {
    data: {
      deployment: {
        id: { owner: "akash1owneraaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", dseq: opts.dseq },
        state: opts.state ?? "active",
        hash: "deadbeef",
        created_at: "1000000"
      },
      leases: Array.from({ length: leaseCount }, () => detailLease(opts)),
      escrow_account: escrow("5000000", "1000000")
    }
  };
}

type ListDeploymentsBody = Body<"/v1/deployments", "get", 200>;
type ListEntry = ListDeploymentsBody["data"]["deployments"][number];

export function deploymentListEntry(dseq: string, state = "active"): ListEntry {
  return {
    deployment: {
      id: { owner: "akash1owneraaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", dseq },
      state,
      hash: "deadbeef",
      created_at: "1000000"
    },
    leases: [
      {
        id: {
          owner: "akash1owneraaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          dseq,
          gseq: 1,
          oseq: 1,
          provider: PROVIDER_ADDRESS,
          bseq: 1
        },
        state: "active",
        price: { denom: "uact", amount: "1.6" },
        created_at: "1000001",
        closed_on: ""
      }
    ],
    escrow_account: escrow("5000000", "1000000")
  };
}

export function deploymentList(entries: ListEntry[], total = entries.length): ListDeploymentsBody {
  return {
    data: {
      deployments: entries,
      pagination: { total, skip: 0, limit: 20, hasMore: false }
    }
  };
}

type ListBidsBody = Body<"/v1/bids", "get", 200>;
type BidEntry = ListBidsBody["data"][number];

export function bid(opts: { dseq: string; provider: string; amountPerBlock: string; state?: string }): BidEntry {
  return {
    bid: {
      id: {
        owner: "akash1owneraaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        dseq: opts.dseq,
        gseq: 1,
        oseq: 1,
        provider: opts.provider,
        bseq: 1
      },
      state: opts.state ?? "open",
      price: { denom: "uact", amount: opts.amountPerBlock },
      created_at: "1000000",
      resources_offer: [
        {
          resources: {
            cpu: { units: { val: "1000" }, attributes: [] },
            gpu: { units: { val: "0" }, attributes: [] },
            memory: { quantity: { val: "536870912" }, attributes: [] },
            storage: [{ name: "default", quantity: { val: "536870912" }, attributes: [] }],
            endpoints: [{ kind: "SHARED_HTTP", sequence_number: 0 }]
          },
          count: 1
        }
      ]
    },
    escrow_account: escrow("500000", "0")
  };
}

export function bids(entries: BidEntry[]): ListBidsBody {
  return { data: entries };
}

/**
 * Provider detail for host-uri resolution. The CLI only reads `hostUri`;
 * the full /v1/providers/{address} type is enormous, so this one is untyped.
 */
export function providerHost(hostUri: string): Record<string, unknown> {
  return { owner: PROVIDER_ADDRESS, hostUri };
}

/** Minimal lease-create success body; the CLI only checks for a 2xx with data. */
export function leaseCreated(dseq: string): Record<string, unknown> {
  return { data: { deployment: { id: { owner: "o", dseq }, state: "active" }, leases: [] } };
}
