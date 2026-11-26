/**
 * Telling a load-bearing module import from a no-op one.
 *
 * When an input's only use is `imports = [ "${input}/path/to/module" ]`, the
 * reference scan can't say whether that module does anything. A Home Manager
 * module typically declares `options.programs.<name>.enable` defaulting to
 * false and gates all its config behind it — so importing it while never
 * setting `enable` contributes exactly nothing, and the input is dead weight
 * that still has to be fetched on every evaluation.
 *
 * The check: resolve the input to its store path, read the imported module,
 * recover the option namespace it declares, and look for anything in the
 * consuming repo that sets that namespace. Every step degrades to "don't know"
 * rather than guessing, because a false "unused" is the expensive mistake.
 */
import { readFile } from "node:fs/promises";
import { scanConsumers } from "./consumers.ts";

/** Store paths of the flake's inputs, via `nix flake archive --json`. */
export async function inputStorePaths(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const proc = Bun.spawn(["nix", "flake", "archive", "--json", "--no-write-lock-file", root], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });
    const [text, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (code !== 0) return out;
    const parsed = JSON.parse(text) as { inputs?: Record<string, { path?: string }> };
    for (const [name, node] of Object.entries(parsed.inputs ?? {})) {
      if (node?.path) out.set(name, node.path);
    }
  } catch {
    // nix absent, offline, or output shape changed — the caller falls back.
  }
  return out;
}

/** The `"${input}/sub/path"` fragment from a module-import line, if present. */
export function importedSubpath(name: string, text: string): string | undefined {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = text.match(new RegExp(`"\\$\\{${esc}\\}/([^"]+)"`));
  return m?.[1];
}

/** The option namespace a module declares, e.g. `programs.devcontainers-cli`. */
export async function declaredNamespace(
  storePath: string,
  subpath: string,
): Promise<string | undefined> {
  const candidates = subpath.endsWith(".nix")
    ? [`${storePath}/${subpath}`]
    : [`${storePath}/${subpath}/default.nix`, `${storePath}/${subpath}.nix`];

  for (const file of candidates) {
    let src: string;
    try {
      src = await readFile(file, "utf8");
    } catch {
      continue;
    }
    // `cfg = config.programs.foo` is the near-universal idiom and the most
    // reliable signal; the `options.` form is the fallback.
    const viaCfg = src.match(/\bcfg\s*=\s*config\.([\w.-]+)/);
    if (viaCfg) return viaCfg[1];
    const viaOptions = src.match(/\boptions\.([\w.-]+)\s*=/);
    if (viaOptions) return viaOptions[1];
  }
  return undefined;
}

/**
 * Does anything in the repo reference this option namespace?
 *
 * flake.nix counts — inline Home Manager / NixOS config there is as much a
 * setting as a module file. What doesn't count is a `"${leaf}/…"` import line,
 * which only matters when the input happens to share the namespace's leaf name.
 */
export async function namespaceIsSet(root: string, namespace: string): Promise<boolean> {
  const leaf = namespace.split(".").pop()!;
  const { consumers } = await scanConsumers(root, [leaf]);
  return (consumers.get(leaf) ?? []).some(
    (c) => c.file !== "flake.nix" || !c.text.includes(`\${${leaf}}`),
  );
}
