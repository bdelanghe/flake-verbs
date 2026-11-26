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

function describe(
  locked: Record<string, unknown>,
  original: Record<string, unknown> = {},
): LockedRef {
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
    ref: typeof original.ref === "string" ? original.ref : undefined,
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

  const out = new Map<string, LockedRef>();
  for (const [name, ref] of Object.entries(rootNode.inputs)) {
    // A follows-path is an array; the node it lands on is the last element.
    const key = Array.isArray(ref) ? ref[ref.length - 1] : ref;
    const node = lock.nodes[key];
    if (!node?.locked) continue;
    out.set(name, describe(node.locked, node.original));
  }
  return out;
}
