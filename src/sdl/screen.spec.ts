import { afterEach, describe, expect, it, vi } from "vitest";

import { buildRequirements, summarizeIncidents, systemTimezone } from "./screen.js";
import type { SdlDoc } from "./types.js";

describe("systemTimezone", () => {
  afterEach(() => vi.restoreAllMocks());

  function mockResolvedZone(zone: string | undefined) {
    vi.spyOn(Intl, "DateTimeFormat").mockReturnValue({
      resolvedOptions: () => ({ timeZone: zone })
    } as unknown as Intl.DateTimeFormat);
  }

  it("passes a supported city zone through unchanged", () => {
    mockResolvedZone("America/Chicago");
    expect(systemTimezone()).toBe("America/Chicago");
  });

  // The bid-screening API rejects these with HTTP 400 "Timezone is not supported".
  it.each(["UTC", "Etc/UTC", "GMT", "Etc/GMT", "etc/utc"])("maps unsupported zone %s to the fallback", (zone) => {
    mockResolvedZone(zone);
    expect(systemTimezone()).toBe("Europe/London");
  });

  it("falls back when the resolved zone is empty", () => {
    mockResolvedZone("");
    expect(systemTimezone()).toBe("Europe/London");
  });

  it("falls back when Intl throws", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
      throw new Error("no Intl");
    });
    expect(systemTimezone()).toBe("Europe/London");
  });
});

describe("buildRequirements", () => {
  it("collects placement attributes and signedBy from the SDL", () => {
    const sdl: SdlDoc = {
      profiles: {
        placement: {
          dc: {
            attributes: { region: "us-west", host: "akash" },
            signedBy: { anyOf: ["akash1auditor"], allOf: [] }
          }
        }
      }
    };

    expect(buildRequirements(sdl)).toEqual({
      attributes: [
        { key: "region", value: "us-west" },
        { key: "host", value: "akash" }
      ],
      signedBy: { anyOf: ["akash1auditor"], allOf: [] }
    });
  });

  it("stringifies non-string attribute values", () => {
    const sdl: SdlDoc = {
      profiles: { placement: { dc: { attributes: { persistent: "false" } } } }
    };
    expect(buildRequirements(sdl).attributes).toEqual([{ key: "persistent", value: "false" }]);
  });

  it("returns an empty object when there are no placements", () => {
    expect(buildRequirements({})).toEqual({});
  });
});

describe("summarizeIncidents", () => {
  it("sums downtime across the window and reports a human duration", () => {
    const result = summarizeIncidents([
      { date: "2026-06-01", hasOpenIncident: false, incidentCount: 1, downtimeSeconds: 3600 },
      { date: "2026-06-02", hasOpenIncident: false, incidentCount: 1, downtimeSeconds: 300 }
    ]);
    expect(result).toEqual({ downtime7d: "1h 5m", openIncident: false });
  });

  it("flags an open incident when any day has one", () => {
    const result = summarizeIncidents([
      { date: "2026-06-01", hasOpenIncident: false, incidentCount: 0, downtimeSeconds: 0 },
      { date: "2026-06-02", hasOpenIncident: true, incidentCount: 1, downtimeSeconds: 120 }
    ]);
    expect(result).toEqual({ downtime7d: "2m", openIncident: true });
  });

  it("reports 0s with no incidents", () => {
    expect(summarizeIncidents([])).toEqual({ downtime7d: "0s", openIncident: false });
    expect(summarizeIncidents()).toEqual({ downtime7d: "0s", openIncident: false });
  });
});
