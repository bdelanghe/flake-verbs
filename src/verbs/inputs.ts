import { z } from "zod";
import { defineVerb } from "@bounded-systems/verbspec";
import { FlakeInput, SCHEMA_VERSION, versioned } from "../nouns.ts";
import { readDirectInputs } from "../lock.ts";
import { scanConsumers } from "../consumers.ts";
import { declaredNamespace, importedSubpath, inputStorePaths, namespaceIsSet } from "../deep.ts";

const Output = versioned({
  root: z.string(),
  inputs: z.array(FlakeInput),
  summary: z.object({
    total: z.number(),
    referenced: z.number(),
    module_import_only: z.number(),
    unused: z.number(),
  }),
});

export const inputs = defineVerb({
  id: "inputs",
  summary: "Every direct flake input, what consumes it, and whether anything does",
  actor: "observer",
  positionals: ["root"],
  input: z.object({
    root: z.string().default("."),
    /** Show only inputs nothing clearly consumes — the pruning shortlist. */
    unusedOnly: z.boolean().default(false),
    /** Resolve module-only inputs to their source to see if any option is enabled. */
    deep: z.boolean().default(true),
  }),
  output: Output,

  run: async ({ root, unusedOnly, deep }) => {
    const locked = await readDirectInputs(root);
    const names = [...locked.keys()];
    const { consumers } = await scanConsumers(root, names);

    // Only pay for the store-path resolution if something actually needs it.
    const moduleOnly = names.filter((n) => {
      const c = consumers.get(n) ?? [];
      return c.length > 0 && c.every((x) => x.via === "module-import");
    });
    const storePaths =
      deep && moduleOnly.length > 0 ? await inputStorePaths(root) : new Map<string, string>();

    const results: z.infer<typeof FlakeInput>[] = [];

    for (const name of names) {
      const found = consumers.get(name) ?? [];
      const ref = locked.get(name)!;

      if (found.length === 0) {
        results.push({
          name,
          locked: ref,
          consumers: [],
          verdict: "unused",
          reason: "nothing outside the inputs block references it",
        });
        continue;
      }

      if (!found.every((c) => c.via === "module-import")) {
        const where = found
          .slice(0, 2)
          .map((c) => `${c.file}:${c.line}`)
          .join(", ");
        results.push({
          name,
          locked: ref,
          consumers: found,
          verdict: "referenced",
          reason: `used at ${where}${found.length > 2 ? ` (+${found.length - 2} more)` : ""}`,
        });
        continue;
      }

      // Imported as a module and nothing else. Try to settle it properly.
      let verdict: z.infer<typeof FlakeInput>["verdict"] = "module-import-only";
      let reason = "imported as a module; nothing else references it";
      let declares: string | undefined;

      const store = storePaths.get(name);
      const sub = found.map((c) => importedSubpath(name, c.text)).find(Boolean);
      if (store && sub) {
        declares = await declaredNamespace(store, sub);
        if (declares) {
          const enabled = await namespaceIsSet(root, declares);
          if (!enabled) {
            verdict = "unused";
            reason = `imports a module declaring ${declares}, which nothing in this flake sets`;
          } else {
            verdict = "referenced";
            reason = `module's ${declares} options are set here`;
          }
        }
      }

      results.push({
        name,
        locked: ref,
        consumers: found,
        verdict,
        reason,
        declares_options: declares,
      });
    }

    const summary = {
      total: results.length,
      referenced: results.filter((r) => r.verdict === "referenced").length,
      module_import_only: results.filter((r) => r.verdict === "module-import-only").length,
      unused: results.filter((r) => r.verdict === "unused").length,
    };

    return {
      schema_version: SCHEMA_VERSION,
      root,
      inputs: unusedOnly ? results.filter((r) => r.verdict !== "referenced") : results,
      summary,
    };
  },

  /**
   * The CLI view leads with the verdict, because the question this gets run for
   * is "what can I delete" — the consumer list is the evidence for that answer,
   * not the answer.
   */
  render: (o) => {
    if (o.inputs.length === 0) return "every input is referenced";
    const mark = (v: string) => (v === "referenced" ? "ok  " : v === "unused" ? "DEAD" : "??  ");
    const width = Math.max(...o.inputs.map((i) => i.name.length));
    const lines = o.inputs.map((i) => {
      const head = `${mark(i.verdict)} ${i.name.padEnd(width)}  ${i.locked.source}`;
      return `${head}\n     ${i.reason}`;
    });
    const s = o.summary;
    return [
      ...lines,
      "",
      `${s.total} inputs — ${s.referenced} referenced, ${s.module_import_only} module-import-only, ${s.unused} unused`,
    ].join("\n");
  },
});
