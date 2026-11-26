#!/usr/bin/env bun
/**
 * Fixture test for the verbs, offline and deterministic:
 *  - `inputs --no-deep` on fixtures/testflake must call `used` referenced,
 *    `dead` unused, and never crash on the path: input.
 *  - `input-drift` must flag `local` as unportable. The two github inputs hit
 *    the network via gh, so their statuses are NOT asserted — only that they
 *    are not misclassified as unportable.
 */
import { inputs } from "./verbs/inputs.ts";
import { inputDrift } from "./verbs/input-drift.ts";

const ROOT = new URL("../fixtures/testflake", import.meta.url).pathname;
let fails = 0;
const expect = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "✓" : "✗ FAIL"}  ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  if (!ok) fails++;
};

const inv = await inputs.run({ root: ROOT, unusedOnly: false, deep: false });
const verdictOf = (n: string) => inv.inputs.find((i) => i.name === n)?.verdict;
expect("used is referenced", verdictOf("used"), "referenced");
expect("dead is unused", verdictOf("dead"), "unused");

const drift = await inputDrift.run({ root: ROOT, problemsOnly: false });
const statusOf = (n: string) => drift.inputs.find((i) => i.name === n)?.status;
expect("local is unportable", statusOf("local"), "unportable");
expect("unportable count", drift.summary.unportable, 1);
// github inputs must not be called unportable, whatever the network said
expect("used not unportable", statusOf("used") === "unportable", false);

// input-drift against a fixture's stand-in `gh` (fixtures/<x>/bin/gh), so the
// upstream answers are fixed and the run stays offline. A child process,
// because Bun.spawn does not see PATH changes made at runtime.
async function driftWithFakeGh(root: string) {
  const mod = new URL("./verbs/input-drift.ts", import.meta.url).pathname;
  const code = `const { inputDrift } = await import(${JSON.stringify(mod)});
    console.log(JSON.stringify(await inputDrift.run({ root: ${JSON.stringify(root)}, problemsOnly: false })));`;
  const proc = Bun.spawn([process.execPath, "-e", code], {
    stdout: "pipe",
    env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}` },
  });
  const [text] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return JSON.parse(text) as Awaited<ReturnType<typeof inputDrift.run>>;
}

// A lock that follows a release branch is compared against that branch, not
// the default one — release-branch backports are not "unpushed commits".
const rel = await driftWithFakeGh(new URL("../fixtures/release", import.meta.url).pathname);
expect("release branch: behind, not orphaned", rel.inputs[0]?.status, "behind");

console.log(fails ? `\n${fails} FAILED` : "\nall verb fixtures pass");
process.exit(fails ? 1 : 0);
