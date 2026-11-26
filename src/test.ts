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

// --deep: an option namespace set inside flake.nix itself is set. Ignoring
// flake.nix turned a load-bearing module import into a false `unused`.
const INFLAKE = new URL("../fixtures/deepinflake", import.meta.url).pathname;
expect("deep: option set in flake.nix counts", await namespaceIsSet(INFLAKE, "programs.devcontainers-cli"), true);
// …but the `"${dx}/…"` import line itself is not a setting of `programs.dx`.
expect("deep: import line is not a setting", await namespaceIsSet(INFLAKE, "programs.dx"), false);

const drift = await inputDrift.run({ root: ROOT, problemsOnly: false });
const statusOf = (n: string) => drift.inputs.find((i) => i.name === n)?.status;
expect("local is unportable", statusOf("local"), "unportable");
expect("unportable count", drift.summary.unportable, 1);
// github inputs must not be called unportable, whatever the network said
expect("used not unportable", statusOf("used") === "unportable", false);

console.log(fails ? `\n${fails} FAILED` : "\nall verb fixtures pass");
process.exit(fails ? 1 : 0);
