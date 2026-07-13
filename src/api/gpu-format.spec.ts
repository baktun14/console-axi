import { describe, expect, it } from "vitest";

import { filterGpuModels, type GpuModel, gpuRow, sortGpuModels } from "./gpu-format.js";

function model(overrides: Partial<GpuModel> = {}): GpuModel {
  return {
    vendor: "nvidia",
    model: "h100",
    ram: "80Gi",
    interface: "SXM5",
    availability: { total: 63, available: 19 },
    providerAvailability: { total: 3, available: 3 },
    price: { currency: "USD", min: 2.01, max: 3.16, avg: 2.58, weightedAverage: 2.73, med: 2.56 },
    ...overrides
  };
}

describe("gpu formatting", () => {
  it("filters by vendor and model case-insensitively (substring)", () => {
    const models = [model(), model({ vendor: "amd", model: "mi300x" })];

    expect(filterGpuModels(models, { vendor: "NVIDIA" })).toHaveLength(1);
    expect(filterGpuModels(models, { model: "H100" })).toHaveLength(1);
    expect(filterGpuModels(models, { model: "h1" })).toHaveLength(1);
    expect(filterGpuModels(models, {})).toHaveLength(2);
  });

  it("--available keeps only models with free GPUs", () => {
    const models = [model(), model({ model: "gtx1050", availability: { total: 1, available: 0 } })];

    const filtered = filterGpuModels(models, { available: true });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.model).toBe("h100");
  });

  it("renders a compact row with a/t availability and hourly prices", () => {
    expect(gpuRow(model())).toEqual({
      vendor: "nvidia",
      model: "h100",
      ram: "80Gi",
      interface: "SXM5",
      available: "19/63",
      providers: "3/3",
      minHr: "$2.01",
      medHr: "$2.56",
      maxHr: "$3.16"
    });
  });

  it("renders '-' prices for models without pricing data", () => {
    const row = gpuRow(model({ price: null }));

    expect(row).toMatchObject({ minHr: "-", medHr: "-", maxHr: "-" });
  });

  it("omits the live column when no live count is passed", () => {
    expect(gpuRow(model())).not.toHaveProperty("live");
  });

  it("adds a live count column when --verify supplies one", () => {
    expect(gpuRow(model(), 4)).toMatchObject({ live: "4" });
    expect(gpuRow(model(), 0)).toMatchObject({ live: "0" });
  });

  it("marks a screening error with '?'", () => {
    expect(gpuRow(model(), null)).toMatchObject({ live: "?" });
  });

  it("sorts by available count desc, then model asc", () => {
    const models = [
      model({ model: "a100", availability: { total: 10, available: 2 } }),
      model({ model: "h200", availability: { total: 40, available: 12 } }),
      model({ model: "b200", availability: { total: 5, available: 12 } })
    ];

    expect(sortGpuModels(models).map((m) => m.model)).toEqual(["b200", "h200", "a100"]);
  });
});
