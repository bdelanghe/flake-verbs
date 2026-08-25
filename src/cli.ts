#!/usr/bin/env bun
/**
 * CLI projection of the verb registry.
 *
 * Thin on purpose. This CLI, the MCP toolset and the OpenAPI operations are all
 * projections of the same specs, so adding a verb to the registry adds it to
 * every surface at once and none of them can describe a verb the others lack.
 */
import { dispatch, render, toMcpToolset, toHelp } from "@bounded-systems/verbspec";
import { emitVerbSpan } from "./otel.ts";
import { inputs } from "./verbs/inputs.ts";
import { inputDrift } from "./verbs/input-drift.ts";

const registry = {
  inputs,
  "input-drift": inputDrift,
};

const argv = process.argv.slice(2);

if (argv[0] === "--mcp-tools") {
  console.log(JSON.stringify(toMcpToolset(registry), null, 2));
  process.exit(0);
}

if (argv.length === 0 || argv[0] === "--help") {
  console.log("flake verbs\n");
  for (const [id, v] of Object.entries(registry)) {
    console.log(`  ${id.padEnd(14)} ${v.summary}`);
  }
  console.log("\n  --mcp-tools    print the MCP toolset derived from these specs");
  console.log("\nRun a verb with --help for its flags.");
  process.exit(0);
}

if (argv[1] === "--help" && argv[0] in registry) {
  console.log(toHelp(registry[argv[0] as keyof typeof registry] as never, "verbs"));
  process.exit(0);
}

const __start = Date.now();
const result = await dispatch(registry, argv);

if (result.kind === "ok") {
  const spec = registry[result.id as keyof typeof registry] as {
    render?: (o: unknown, i: unknown) => string;
    warnings?: (o: unknown, i: unknown) => readonly string[];
    exitCode?: (o: unknown, i: unknown) => number;
  };
  // Warnings go to stderr so piping the structured output stays clean.
  for (const w of spec?.warnings?.(result.output, result.input) ?? []) {
    console.error(`warning: ${w}`);
  }
  console.log(spec?.render ? spec.render(result.output, result.input) : render(result.output));
  const code = spec?.exitCode?.(result.output, result.input) ?? 0;
  const __root = (result.input as { root?: string } | undefined)?.root ?? "";
  const __m = __root.match(/repos\/io\.github\/([^/]+\/[^/]+)/);
  await emitVerbSpan({ verb: result.id, ok: code === 0, exitCode: code, startMs: __start,
    attributes: __m ? { repo: __m[1] } : {} });
  process.exit(code);
} else {
  console.error(result.message ?? String(result.kind));
  await emitVerbSpan({ verb: String(argv[0] ?? "?"), ok: false, exitCode: result.exitCode ?? 1, startMs: __start });
  process.exit(result.exitCode ?? 1);
}
