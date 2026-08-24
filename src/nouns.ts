/**
 * The things these verbs talk about.
 *
 * Both verbs read the same `flake.lock`, so the reference shapes are shared:
 * `inputs` answers "does anything use this" and `input-drift` answers "is this
 * still what upstream has", but they are describing the same set of edges. One
 * definition keeps the two surfaces talking about the same world.
 */
import { z } from "zod";

/** Wrap an output shape with the contract version every verb here emits. */
export const versioned = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ schema_version: z.number(), ...shape });

export const SCHEMA_VERSION = 1;

/**
 * How an input is fetched. `path` is called out because it is the one type
 * that cannot survive a move to another machine: Nix re-reads a path input
 * from disk at evaluation time, so a lock entry pointing at a directory that
 * only exists on the authoring machine makes the flake unevaluable elsewhere.
 */
export const InputType = z.enum(["github", "git", "path", "tarball", "indirect", "other"]);
export type InputType = z.infer<typeof InputType>;

export const LockedRef = z.object({
  type: InputType,
  /** Human-readable origin, e.g. `github:owner/repo` or `path:/Users/…`. */
  source: z.string(),
  owner: z.string().optional(),
  repo: z.string().optional(),
  rev: z.string().optional(),
  /** Epoch seconds recorded in the lock. */
  last_modified: z.number().optional(),
  last_modified_iso: z.string().optional(),
});
export type LockedRef = z.infer<typeof LockedRef>;

/**
 * Where an input is actually used.
 *
 * `via` matters because the three kinds carry different weight. A `direct`
 * reference in a module file is unambiguous use. An `alias` reference is the
 * `foo = config._module.args.bar` indirection — the local name often differs
 * from the input name, which is exactly how a used input gets mistaken for a
 * dead one. A `module-import` is the weakest signal: importing a module says
 * nothing about whether any of its options were ever switched on.
 */
export const Consumer = z.object({
  file: z.string(),
  line: z.number(),
  text: z.string(),
  via: z.enum(["direct", "alias", "module-import"]),
  /** Local binding the input was renamed to, when `via` is `alias`. */
  alias: z.string().optional(),
});
export type Consumer = z.infer<typeof Consumer>;

/**
 * `module-import-only` is deliberately not called "unused". Importing a Home
 * Manager module can be entirely load-bearing (the module sets config on its
 * own) or a complete no-op (every option defaults to false and nothing enables
 * them). Telling those apart needs the module's own source, which `--deep`
 * fetches; without it the honest answer is "a human should look".
 */
export const Verdict = z.enum(["referenced", "module-import-only", "unused"]);
export type Verdict = z.infer<typeof Verdict>;

export const FlakeInput = z.object({
  name: z.string(),
  locked: LockedRef,
  consumers: z.array(Consumer),
  verdict: Verdict,
  reason: z.string(),
  /** Option namespace a module-only input declares, when `--deep` resolved it. */
  declares_options: z.string().optional(),
});
export type FlakeInput = z.infer<typeof FlakeInput>;

/**
 * `orphaned` is the finding worth building this for: the locked revision is not
 * reachable on the remote's default branch. That means the commit exists only
 * in a local checkout — unpushed work that a machine rebuild silently discards.
 */
export const DriftStatus = z.enum(["current", "behind", "orphaned", "unportable", "unknown"]);
export type DriftStatus = z.infer<typeof DriftStatus>;

export const InputDrift = z.object({
  name: z.string(),
  status: DriftStatus,
  locked: LockedRef,
  upstream_rev: z.string().optional(),
  upstream_date: z.string().optional(),
  detail: z.string(),
});
export type InputDrift = z.infer<typeof InputDrift>;
