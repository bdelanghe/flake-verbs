/**
 * Finding where an input is actually used.
 *
 * A plain grep for the input's name is wrong twice over. It counts the `inputs
 * = { … }` block in `flake.nix`, which is the declaration rather than a use;
 * and it misses every input consumed through `_module.args`, where the local
 * binding is frequently a different word than the input name
 * (`synoptic = config._module.args.synoptic-github`). Both mistakes point the
 * same way — toward calling a live input dead — so the scan resolves aliases
 * and excludes the declaration block.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Consumer } from "./nouns.ts";

const SKIP_DIRS = new Set([".git", "node_modules", "result", ".direnv"]);

async function nixFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(join(dir, e.name));
      } else if (e.name.endsWith(".nix")) {
        found.push(join(dir, e.name));
      }
    }
  }
  await walk(root);
  return found;
}

/** Match `name` as a whole Nix identifier — `-` is an identifier char here. */
function identRe(name: string): RegExp {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w-])${esc}(?![\\w-])`);
}

/**
 * The lines of `flake.nix` that declare inputs rather than use them: the
 * `inputs = { … }` block, and equally every dotted top-level declaration —
 * `inputs.x.url = …`, `inputs.x.inputs.y.follows = …`, `inputs.x = { … };`.
 * Missing the dotted form made every input in such a flake look referenced.
 *
 * Only statements at the flake's top level (brace depth 1) count, so an
 * `inputs.x…` inside `outputs` is still read as a use. Brace-counted over
 * sanitized code, so braces in comments and strings don't shift the depth.
 */
function inputsBlockLines(lines: string[]): Set<number> {
  const out = new Set<number>();
  let depth = 0;
  let inDecl = false;
  for (let i = 0; i < lines.length; i++) {
    const code = sanitize(lines[i]);
    if (!inDecl && depth === 1 && /^\s*inputs\s*[.=]/.test(code)) inDecl = true;
    for (const ch of code) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    if (inDecl) {
      out.add(i + 1);
      // The statement ends once its braces have closed back to the top level.
      if (depth <= 1) inDecl = false;
    }
  }
  return out;
}


/**
 * Reduce a line to the parts that can actually *use* an input.
 *
 * Three things mention an input's name without depending on it, and all three
 * were enough to make every input in a real flake look alive: a comment, a
 * path literal like `./programs/lnzr.nix`, and the inert text of a string such
 * as `"lnzr/.keep"`. String *interpolations* are kept, because
 * `"${dx-compose}/some/module"` is a genuine reference — that asymmetry is the
 * whole reason this can't be a grep.
 */
function sanitize(line: string): string {
  // Comments, respecting quotes so a `#` inside a string survives.
  let out = "";
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && line[i - 1] !== "\\") inStr = !inStr;
    if (c === "#" && !inStr) break;
    out += c;
  }

  // String bodies become blanks; `${...}` inside them is preserved.
  out = out.replace(/"([^"\\]|\\.)*"/g, (m) => {
    let kept = '"';
    let i = 1;
    while (i < m.length - 1) {
      if (m[i] === "$" && m[i + 1] === "{") {
        let depth = 1;
        let j = i + 2;
        while (j < m.length && depth > 0) {
          if (m[j] === "{") depth++;
          else if (m[j] === "}") depth--;
          j++;
        }
        kept += m.slice(i, j);
        i = j;
      } else {
        kept += " ";
        i++;
      }
    }
    return kept + '"';
  });

  // Path literals — `./programs/lnzr.nix` names a file, not the input.
  out = out.replace(/\.{1,2}\/[\w./-]+/g, (m) => " ".repeat(m.length));
  return out;
}

/**
 * Lines of the `outputs = { a, b, … }:` parameter list.
 *
 * Destructuring the inputs is how a flake *names* them, not how it uses them —
 * counting it marks every input in the flake as consumed.
 */
function outputsParamLines(lines: string[]): Set<number> {
  const out = new Set<number>();
  let depth = 0;
  let started = false;
  let opened = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!started && /^\s*outputs\s*=\s*\{/.test(line)) started = true;
    if (!started) continue;
    out.add(i + 1);
    // Stop the moment the PARAM braces close — an outputs body whose attrset
    // opens on the same line (`outputs = {...}: {`) must not be swallowed.
    // Fixture-test-caught bug: line-granular net counting let `}: {` read as
    // still-open and excluded the entire body from reference scanning.
    let done = false;
    for (const ch of line) {
      if (ch === "{") { depth++; opened = true; }
      else if (ch === "}") { depth--; if (opened && depth === 0) { done = true; break; } }
    }
    if (done) break;
  }
  return out;
}

export type ScanResult = {
  consumers: Map<string, Consumer[]>;
  /** Every `local = config._module.args.input` binding found. */
  aliases: Map<string, string>;
};

export async function scanConsumers(root: string, names: string[]): Promise<ScanResult> {
  const files = await nixFiles(root);
  const consumers = new Map<string, Consumer[]>(names.map((n) => [n, []]));
  const aliases = new Map<string, string>();

  type Line = { file: string; rel: string; n: number; text: string; code: string; declaration: boolean };
  const allLines: Line[] = [];

  for (const file of files) {
    const rel = relative(root, file);
    const lines = (await readFile(file, "utf8")).split("\n");
    const declLines =
      rel === "flake.nix"
        ? new Set<number>([...inputsBlockLines(lines), ...outputsParamLines(lines)])
        : new Set<number>();
    lines.forEach((text, i) => {
      allLines.push({
        file,
        rel,
        n: i + 1,
        text,
        code: sanitize(text),
        declaration: declLines.has(i + 1),
      });
    });
  }

  // Pass one: alias bindings, so pass two can follow the local name.
  const aliasRe = /([A-Za-z_][\w-]*)\s*=\s*config\._module\.args\.([A-Za-z_][\w-]*)/;
  for (const l of allLines) {
    const m = l.code.match(aliasRe);
    if (m && names.includes(m[2])) aliases.set(m[1], m[2]);
  }

  // Pass two: every reference, attributed to the input it ultimately names.
  for (const name of names) {
    const re = identRe(name);
    const localNames = [...aliases.entries()].filter(([, v]) => v === name).map(([k]) => k);
    const localRes = localNames.map((l) => [l, identRe(l)] as const);
    const seen = new Set<string>();
    const push = (c: Consumer) => {
      const key = `${c.file}:${c.line}`;
      if (seen.has(key)) return;
      seen.add(key);
      consumers.get(name)!.push(c);
    };

    for (const l of allLines) {
      if (l.declaration) continue;
      const text = l.text.trim();

      if (re.test(l.code)) {
        // A module path built by interpolating the input — `"${x}/some/module"`.
        // Importing a module is not evidence any of its options were enabled.
        const isModuleImport =
          l.rel === "flake.nix" &&
          (new RegExp(`\\$\\{${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}`).test(l.code) ||
            /homeManagerModules|darwinModules|nixosModules/.test(l.code));
        push({
          file: l.rel,
          line: l.n,
          text,
          via: isModuleImport ? "module-import" : "direct",
        });
        continue;
      }

      for (const [local, lre] of localRes) {
        if (lre.test(l.code)) {
          push({ file: l.rel, line: l.n, text, via: "alias", alias: local });
          break;
        }
      }
    }
  }

  return { consumers, aliases };
}
