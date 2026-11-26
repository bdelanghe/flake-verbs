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
import { namespaceIsSet } from "./deep.ts";

import { readDirectInputs } from "./lock.ts";

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

// `outputs = inputs@{ … }:` names inputs just like `outputs = { … }:` does,
// including when the param list continues onto the next line.
const AT = new URL("../fixtures/atpattern", import.meta.url).pathname;
const at = await inputs.run({ root: AT, unusedOnly: false, deep: false });
const atVerdict = (n: string) => at.inputs.find((i) => i.name === n)?.verdict;
expect("at-pattern: used is referenced", atVerdict("used"), "referenced");
expect("at-pattern: dead is unused", atVerdict("dead"), "unused");
expect("at-pattern: alsodead is unused", atVerdict("alsodead"), "unused");

// --deep: an option namespace set inside flake.nix itself is set. Ignoring
// flake.nix turned a load-bearing module import into a false `unused`.
const INFLAKE = new URL("../fixtures/deepinflake", import.meta.url).pathname;
expect("deep: option set in flake.nix counts", await namespaceIsSet(INFLAKE, "programs.devcontainers-cli"), true);
// …but the `"${dx}/…"` import line itself is not a setting of `programs.dx`.
expect("deep: import line is not a setting", await namespaceIsSet(INFLAKE, "programs.dx"), false);

// A follows path is input names walked from the root, not a node key:
// ["hm", "nixpkgs"] lands on hm's nixpkgs (node `nixpkgs_2`), not root's.
const FOLLOWS = new URL("../fixtures/follows", import.meta.url).pathname;
const followed = await readDirectInputs(FOLLOWS);
expect("follows: hmpkgs resolves via hm", followed.get("hmpkgs")?.rev, "3".repeat(40));
expect("follows: nixpkgs is root's own", followed.get("nixpkgs")?.rev, "1".repeat(40));

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

// A failed compare is only evidence of an orphaned rev when GitHub says the
// rev doesn't exist (404). A server error or timeout is "unknown", not LOST.
const cf = await driftWithFakeGh(new URL("../fixtures/comparefail", import.meta.url).pathname);
const cfStatus = (n: string) => cf.inputs.find((i) => i.name === n)?.status;
expect("compare 5xx: unknown, not orphaned", cfStatus("flaky"), "unknown");
expect("compare 404: still orphaned", cfStatus("gone"), "orphaned");

console.log(fails ? `\n${fails} FAILED` : "\nall verb fixtures pass");
process.exit(fails ? 1 : 0);
