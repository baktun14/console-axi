import { describe, expect, it } from "vitest";

import { buildRequirements, summarizeIncidents } from "./screen.js";
import type { SdlDoc } from "./types.js";

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
