import { describe, expect, it } from "vitest";

import { categorySummary, clipSummary, filterTemplates, flattenCatalog } from "./template-catalog.js";

const CATALOG = [
  {
    title: "AI - GPU",
    templates: [
      { id: "akash-network-awesome-akash-Llama-3.1", name: "Llama 3.1", logoUrl: null, summary: "Run Llama", tags: ["ai", "llm"] },
      { id: "akash-network-awesome-akash-jupyter", name: "Jupyter", logoUrl: null, summary: "Notebooks with GPU", tags: ["notebook"] }
    ]
  },
  {
    title: "Hosting",
    templates: [{ id: "akash-network-awesome-akash-wordpress", name: "WordPress", logoUrl: null, summary: "Blog hosting" }]
  }
];

describe("template catalog", () => {
  it("flattens categories onto each template", () => {
    const flat = flattenCatalog(CATALOG);

    expect(flat).toHaveLength(3);
    expect(flat[0]).toMatchObject({ id: "akash-network-awesome-akash-Llama-3.1", category: "AI - GPU" });
    expect(flat[2]).toMatchObject({ name: "WordPress", category: "Hosting" });
  });

  it("searches name, summary and tags case-insensitively", () => {
    const flat = flattenCatalog(CATALOG);

    expect(filterTemplates(flat, { search: "LLAMA" })).toHaveLength(1);
    expect(filterTemplates(flat, { search: "gpu" })).toHaveLength(1);
    expect(filterTemplates(flat, { search: "llm" })).toHaveLength(1);
    expect(filterTemplates(flat, { search: "nomatch" })).toHaveLength(0);
  });

  it("filters by category substring", () => {
    const flat = flattenCatalog(CATALOG);

    expect(filterTemplates(flat, { category: "hosting" })).toHaveLength(1);
    expect(filterTemplates(flat, { category: "ai" })).toHaveLength(2);
  });

  it("summarizes categories with counts", () => {
    expect(categorySummary(CATALOG)).toEqual([
      { category: "AI - GPU", templates: 2 },
      { category: "Hosting", templates: 1 }
    ]);
  });

  it("clips long summaries with an ellipsis", () => {
    expect(clipSummary("short")).toBe("short");
    const long = "x".repeat(150);
    expect(clipSummary(long)).toHaveLength(101);
    expect(clipSummary(long).endsWith("…")).toBe(true);
  });
});
