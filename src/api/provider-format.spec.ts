import { describe, expect, it } from "vitest";

import {
  filterProviders,
  formatUptime,
  gpuSummary,
  type ProviderListItem,
  providerRow,
  sortProviders
} from "./provider-format.js";

function provider(overrides: Partial<ProviderListItem> = {}): ProviderListItem {
  return {
    owner: "akash1prov",
    name: "provider.example.com",
    hostUri: "https://provider.example.com:8443",
    createdHeight: 1,
    cosmosSdkVersion: "0.45",
    akashVersion: "0.38",
    ipRegion: "Sofia-Capital",
    ipRegionCode: "22",
    ipCountry: "Bulgaria",
    ipCountryCode: "BG",
    ipLat: "0",
    ipLon: "0",
    uptime1d: 1,
    uptime7d: 0.999,
    uptime30d: 0.9958,
    isValidVersion: true,
    isOnline: true,
    lastOnlineDate: null,
    isAudited: true,
    leaseCount: 78,
    gpuModels: [],
    attributes: [],
    host: null,
    organization: "digital frontier",
    statusPage: null,
    locationRegion: "eu-southeast",
    country: null,
    city: null,
    timezone: null,
    locationType: null,
    hostingProvider: null,
    hardwareCpu: null,
    hardwareCpuArch: null,
    hardwareGpuVendor: null,
    hardwareGpuModels: null,
    hardwareDisk: null,
    featPersistentStorage: false,
    featPersistentStorageType: null,
    hardwareMemory: null,
    networkProvider: null,
    networkSpeedDown: 0,
    networkSpeedUp: 0,
    tier: "community",
    featEndpointCustomDomain: false,
    workloadSupportChia: false,
    workloadSupportChiaCapabilities: null,
    featEndpointIp: false,
    ...overrides
  };
}

describe("provider formatting", () => {
  it("drops offline providers unless --all", () => {
    const list = [provider(), provider({ owner: "akash1off", isOnline: false })];

    expect(filterProviders(list, {})).toHaveLength(1);
    expect(filterProviders(list, { all: true })).toHaveLength(2);
  });

  it("matches --gpu-model case-insensitively against the model list", () => {
    const list = [
      provider({ gpuModels: [{ vendor: "nvidia", model: "h100", ram: "80Gi", interface: "SXM5" }] }),
      provider({ owner: "akash1cpu" })
    ];

    expect(filterProviders(list, { gpuModel: "H100" })).toHaveLength(1);
    expect(filterProviders(list, { gpuModel: "a100" })).toHaveLength(0);
  });

  it("matches --region across location and ip fields with null fallbacks", () => {
    const list = [
      provider(),
      provider({ owner: "akash1na", locationRegion: null, ipRegion: "Virginia", ipRegionCode: "VA" })
    ];

    expect(filterProviders(list, { region: "eu-southeast" })).toHaveLength(1);
    expect(filterProviders(list, { region: "va" })).toHaveLength(1);
    expect(filterProviders(list, { region: "virginia" })).toHaveLength(1);
  });

  it("filters audited providers", () => {
    const list = [provider(), provider({ owner: "akash1new", isAudited: false })];

    expect(filterProviders(list, { audited: true })).toHaveLength(1);
  });

  it("sorts by uptime30d desc (nulls last), then leases desc", () => {
    const list = [
      provider({ owner: "a", uptime30d: 0.9, leaseCount: 1 }),
      provider({ owner: "b", uptime30d: null, leaseCount: 99 }),
      provider({ owner: "c", uptime30d: 0.99, leaseCount: 5 }),
      provider({ owner: "d", uptime30d: 0.99, leaseCount: 50 })
    ];

    expect(sortProviders(list).map((p) => p.owner)).toEqual(["d", "c", "a", "b"]);
  });

  it("formats uptime fractions as percentages", () => {
    expect(formatUptime(0.9958703)).toBe("99.6%");
    expect(formatUptime(1)).toBe("100%");
    expect(formatUptime(null)).toBe("-");
  });

  it("summarizes gpu models with dedupe counts", () => {
    const models = [
      { vendor: "nvidia", model: "h100", ram: "80Gi", interface: "SXM5" },
      { vendor: "nvidia", model: "h100", ram: "80Gi", interface: "SXM5" },
      { vendor: "nvidia", model: "a100", ram: "80Gi", interface: "SXM4" }
    ];

    expect(gpuSummary(models)).toBe("h100 x2, a100");
    expect(gpuSummary([])).toBe("-");
  });

  it("builds a row with null-coalesced fields", () => {
    expect(providerRow(provider({ organization: null, name: null, locationRegion: null, ipRegionCode: null, leaseCount: null }))).toEqual({
      owner: "akash1prov",
      org: "-",
      region: "Sofia-Capital",
      uptime7d: "99.9%",
      audited: true,
      leases: 0,
      gpus: "-"
    });
  });
});
