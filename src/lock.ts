/**
 * Reading `flake.lock`.
 *
 * The lock is the only place that records what an input *actually resolved to*
 * — `flake.nix` records the request, the lock records the answer. Both verbs
 * want the answer, so parsing lives here rather than in either verb.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LockedRef, InputType } from "./nouns.ts";

type LockNode = {
  inputs?: Record<string, string | string[]>;
  locked?: Record<string, unknown>;
  original?: Record<string, unknown>;
};
type Lock = { nodes: Record<string, LockNode>; root: string; version: number };

function describe(locked: Record<string, unknown>): LockedRef {
  const rawType = String(locked.type ?? "other");
  const known = ["github", "git", "path", "tarball", "indirect"];
  const type = (known.includes(rawType) ? rawType : "other") as InputType;

  let source: string;
  if (type === "github") source = `github:${locked.owner}/${locked.repo}`;
  else if (type === "path") source = `path:${locked.path}`;
  else if (type === "git") source = String(locked.url ?? "git");
  else if (type === "tarball") source = String(locked.url ?? "tarball");
  else source = rawType;

  const lastModified =
    typeof locked.lastModified === "number" ? locked.lastModified : undefined;

  return {
    type,
    source,
    owner: typeof locked.owner === "string" ? locked.owner : undefined,
    repo: typeof locked.repo === "string" ? locked.repo : undefined,
    rev: typeof locked.rev === "string" ? locked.rev : undefined,
    last_modified: lastModified,
    last_modified_iso: lastModified
      ? new Date(lastModified * 1000).toISOString().slice(0, 10)
      : undefined,
  };
}

/**
 * The flake's *direct* inputs, in lock order.
 *
 * Transitive inputs are deliberately excluded: this answers "what did I choose
 * to depend on", and a transitive input is someone else's choice to audit in
 * their own repo.
 */
export async function readDirectInputs(root: string): Promise<Map<string, LockedRef>> {
  const path = join(root, "flake.lock");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(`no flake.lock at ${path} — is ${root} a locked flake?`);
  }

  let lock: Lock;
  try {
    lock = JSON.parse(raw);
  } catch (e) {
    throw new Error(`flake.lock at ${path} is not valid JSON: ${(e as Error).message}`);
  }

  const rootNode = lock.nodes?.[lock.root];
  if (!rootNode?.inputs) throw new Error(`flake.lock at ${path} has no root inputs`);

  // A follows-path is an array of input *names* walked from the root node —
  // its last element is an input name, not a node key (node keys get `_2`
  // suffixes on collision). Each hop may itself be a follows; `seen` stops a
  // malformed lock from looping.
  const resolve = (path: string[], seen = new Set<string>()): string | undefined => {
    let key: string | undefined = lock.root;
    for (const step of path) {
      const next: string | string[] | undefined = lock.nodes[key!]?.inputs?.[step];
      if (next === undefined) return undefined;
      if (Array.isArray(next)) {
        const id = next.join("/");
        if (seen.has(id)) return undefined;
        key = resolve(next, new Set(seen).add(id));
      } else {
        key = next;
      }
      if (key === undefined) return undefined;
    }
    return key;
  };

  const out = new Map<string, LockedRef>();
  for (const [name, ref] of Object.entries(rootNode.inputs)) {
    const key = Array.isArray(ref) ? resolve(ref) : ref;
    const node = key === undefined ? undefined : lock.nodes[key];
    if (!node?.locked) continue;
    out.set(name, describe(node.locked));
  }
  return out;
}
