import type { Command } from "commander";

import { unwrap } from "../api/client.js";
import { categorySummary, clipSummary, filterTemplates, flattenCatalog } from "../api/template-catalog.js";
import { action, anonContext } from "../context.js";
import { printResult } from "../output/render.js";
import { truncate } from "../output/truncate.js";
import { summarizeSdl } from "../sdl/summary.js";
import { validateSdl } from "../sdl/validate.js";

export function registerTemplate(program: Command): void {
  const template = program
    .command("template")
    .description("Browse the Console deployment-template catalog (no key needed)");

  template
    .command("list")
    .description("List catalog templates; without filters shows the category summary")
    .option("--category <name>", "filter by category substring, e.g. ai")
    .option("--search <term>", "search name/summary/tags")
    .option("--limit <n>", "max rows", "20")
    .action(
      action(async (opts: { category?: string; search?: string; limit: string }, command: Command) => {
        const { client } = anonContext(command);
        const data = unwrap(await client.GET("/v1/templates-list")).data;

        // The catalog is ~400 templates: content-first means the category map,
        // not a dump. Filters switch to actual rows.
        if (!opts.category && !opts.search) {
          printResult(
            {
              categories: categorySummary(data),
              note: "Pass --search <term> and/or --category <name> to list templates."
            },
            { help: ["console-axi template list --search jupyter", "console-axi template list --category ai"] }
          );
          return;
        }

        const matched = filterTemplates(flattenCatalog(data), opts);
        if (matched.length === 0) {
          printResult({ templates: "0 matched" }, { help: ["console-axi template list"] });
          return;
        }
        const rows = matched.slice(0, Number(opts.limit)).map((t) => ({
          id: t.id,
          name: t.name,
          category: t.category,
          summary: clipSummary(t.summary)
        }));
        printResult(
          { count: `${rows.length} shown of ${matched.length} matched`, templates: rows },
          { help: ["console-axi template view <id>", "console-axi template sdl <id> > app.yml"] }
        );
      })
    );

  template
    .command("view <id>")
    .description("Template details, readme and an SDL digest")
    .option("--full", "print the full readme")
    .action(
      action(async (id: string, opts: { full?: boolean }, command: Command) => {
        const { client } = anonContext(command);
        const data = unwrap(await client.GET("/v1/templates/{id}", { params: { path: { id } } })).data;

        const result: Record<string, unknown> = {
          id: data.id,
          name: data.name,
          summary: data.summary,
          githubUrl: data.githubUrl,
          persistentStorage: data.persistentStorageEnabled,
          ssh: data.config.ssh ?? false
        };

        // Catalog SDLs can be stale; a failed digest is signal, not an error.
        const validation = validateSdl(data.deploy);
        result.sdl =
          validation.valid && validation.parsed
            ? summarizeSdl(validation.parsed)
            : { valid: false, errors: validation.errors.slice(0, 5).map((e) => e.message) };

        result.readme = truncate(data.readme, opts.full ?? false);

        printResult(result, {
          help: [`console-axi template sdl ${id} > app.yml`, "console-axi sdl validate app.yml"]
        });
      })
    );

  template
    .command("sdl <id>")
    .description("Print the template's deploy SDL (raw YAML on stdout, pipeable)")
    .action(
      action(async (id: string, _opts: unknown, command: Command) => {
        const { client } = anonContext(command);
        const data = unwrap(await client.GET("/v1/templates/{id}", { params: { path: { id } } })).data;

        const validation = validateSdl(data.deploy);
        if (!validation.valid) {
          // stdout must stay pipeable YAML; warnings belong on stderr.
          process.stderr.write(
            `warning: template SDL fails offline validation (${validation.errors.length} error(s)); pipe into \`sdl validate -\` for details\n`
          );
        }
        process.stdout.write(data.deploy.endsWith("\n") ? data.deploy : `${data.deploy}\n`);
      })
    );
}
