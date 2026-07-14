import type { paths } from "./schema.js";

export type CatalogCategory =
  paths["/v1/templates-list"]["get"]["responses"][200]["content"]["application/json"]["data"][number];
export type CatalogTemplate = CatalogCategory["templates"][number];

export interface FlatTemplate extends CatalogTemplate {
  category: string;
}

export function flattenCatalog(categories: CatalogCategory[]): FlatTemplate[] {
  return categories.flatMap((c) => c.templates.map((t) => ({ ...t, category: c.title })));
}

export interface TemplateFilters {
  category?: string;
  search?: string;
}

export function filterTemplates(templates: FlatTemplate[], filters: TemplateFilters): FlatTemplate[] {
  const category = filters.category?.toLowerCase();
  const search = filters.search?.toLowerCase();
  return templates.filter((t) => {
    if (category && !t.category.toLowerCase().includes(category)) return false;
    if (search) {
      const haystack = [t.name, t.summary, ...(t.tags ?? [])].join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

export function categorySummary(categories: CatalogCategory[]): Array<{ category: string; templates: number }> {
  return categories.map((c) => ({ category: c.title, templates: c.templates.length }));
}

const SUMMARY_MAX = 100;

export function clipSummary(summary: string): string {
  return summary.length > SUMMARY_MAX ? `${summary.slice(0, SUMMARY_MAX)}…` : summary;
}
