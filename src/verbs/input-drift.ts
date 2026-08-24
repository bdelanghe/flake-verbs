import { z } from "zod";
import { defineVerb } from "@bounded-systems/verbspec";
import { InputDrift, SCHEMA_VERSION, versioned } from "../nouns.ts";
import { readDirectInputs } from "../lock.ts";

const Output = versioned({
  root: z.string(),
  inputs: z.array(InputDrift),
  summary: z.object({
    total: z.number(),
    current: z.number(),
    behind: z.number(),
    orphaned: z.number(),
    unportable: z.number(),
    unknown: z.number(),
  }),
});

/**
 * Talk to GitHub through `gh`, not fetch.
 *
 * `gh` already holds the credential, so private inputs resolve without this
 * verb ever handling a token — nothing to pass in, nothing to leak into a
 * process listing or an MCP transcript.
 */
async function ghJson<T>(args: string[]): Promise<T | null> {
  try {
    const proc = Bun.spawn(["gh", "api", ...args], { stdout: "pipe", stderr: "pipe" });
    const [text, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (code !== 0) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export const inputDrift = defineVerb({
  id: "input-drift",
  summary: "How far each locked input has drifted from its upstream, and which are unrecoverable",
  actor: "observer",
  positionals: ["root"],
  input: z.object({
    root: z.string().default("."),
    /** Report only the inputs that need action. */
    problemsOnly: z.boolean().default(false),
  }),
  output: Output,

  run: async ({ root, problemsOnly }) => {
    const locked = await readDirectInputs(root);
    const results: z.infer<typeof InputDrift>[] = [];

    for (const [name, ref] of locked) {
      // A path input is not a drift question — it cannot be fetched from
      // anywhere else at all, so no other machine can evaluate this flake.
      if (ref.type === "path") {
        results.push({
          name,
          status: "unportable",
          locked: ref,
          detail: `local path only (${ref.source.replace(/^path:/, "")}) — no other machine can evaluate this`,
        });
        continue;
      }

      if (ref.type !== "github" || !ref.owner || !ref.repo || !ref.rev) {
        results.push({
          name,
          status: "unknown",
          locked: ref,
          detail: `${ref.type} input — not checked`,
        });
        continue;
      }

      const slug = `${ref.owner}/${ref.repo}`;
      const meta = await ghJson<{ default_branch: string }>([`repos/${slug}`]);
      if (!meta) {
        results.push({
          name,
          status: "unknown",
          locked: ref,
          detail: `could not reach ${slug} (private, renamed, or gh not authenticated)`,
        });
        continue;
      }

      const branch = meta.default_branch;
      const head = await ghJson<{ sha: string; commit: { committer: { date: string } } }>([
        `repos/${slug}/commits/${branch}`,
      ]);
      const upstreamRev = head?.sha;
      const upstreamDate = head?.commit?.committer?.date?.slice(0, 10);

      if (upstreamRev && upstreamRev === ref.rev) {
        results.push({
          name,
          status: "current",
          locked: ref,
          upstream_rev: upstreamRev,
          upstream_date: upstreamDate,
          detail: `at ${branch} head`,
        });
        continue;
      }

      // `compare/<locked>...<branch>` separates the two ways a lock can differ:
      // commits the branch has that the lock doesn't (ordinary staleness), and
      // commits the *lock* has that the branch doesn't — which means the
      // revision was never pushed, and rebuilding elsewhere silently loses it.
      const cmp = await ghJson<{ ahead_by: number; behind_by: number }>([
        `repos/${slug}/compare/${ref.rev}...${branch}`,
      ]);

      if (!cmp) {
        results.push({
          name,
          status: "orphaned",
          locked: ref,
          upstream_rev: upstreamRev,
          upstream_date: upstreamDate,
          detail: `locked rev ${ref.rev.slice(0, 7)} is unknown to ${slug} — it exists only in a local checkout`,
        });
        continue;
      }

      if (cmp.behind_by > 0) {
        results.push({
          name,
          status: "orphaned",
          locked: ref,
          upstream_rev: upstreamRev,
          upstream_date: upstreamDate,
          detail: `locked rev carries ${cmp.behind_by} commit(s) not on ${branch} — unpushed or on a deleted branch`,
        });
        continue;
      }

      results.push({
        name,
        status: cmp.ahead_by > 0 ? "behind" : "current",
        locked: ref,
        upstream_rev: upstreamRev,
        upstream_date: upstreamDate,
        detail:
          cmp.ahead_by > 0
            ? `${cmp.ahead_by} commit(s) behind ${branch} (locked ${ref.last_modified_iso ?? "?"}, head ${upstreamDate ?? "?"})`
            : `at ${branch} head`,
      });
    }

    const count = (s: string) => results.filter((r) => r.status === s).length;
    return {
      schema_version: SCHEMA_VERSION,
      root,
      inputs: problemsOnly ? results.filter((r) => r.status !== "current") : results,
      summary: {
        total: results.length,
        current: count("current"),
        behind: count("behind"),
        orphaned: count("orphaned"),
        unportable: count("unportable"),
        unknown: count("unknown"),
      },
    };
  },

  /** Orphaned and unportable are the two that cost you a machine rebuild. */
  exitCode: (o) => (o.summary.orphaned > 0 || o.summary.unportable > 0 ? 1 : 0),

  warnings: (o) =>
    o.inputs
      .filter((i) => i.status === "orphaned")
      .map((i) => `${i.name}: ${i.detail}`),

  render: (o) => {
    if (o.inputs.length === 0) return "every input is at its upstream head";
    const mark: Record<string, string> = {
      current: "ok  ",
      behind: "old ",
      orphaned: "LOST",
      unportable: "LOCAL",
      unknown: "??  ",
    };
    const width = Math.max(...o.inputs.map((i) => i.name.length));
    const lines = o.inputs.map(
      (i) => `${(mark[i.status] ?? "??").padEnd(6)}${i.name.padEnd(width)}  ${i.detail}`,
    );
    const s = o.summary;
    return [
      ...lines,
      "",
      `${s.total} inputs — ${s.current} current, ${s.behind} behind, ${s.orphaned} orphaned, ${s.unportable} unportable, ${s.unknown} unknown`,
    ].join("\n");
  },
});
