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

console.log(fails ? `\n${fails} FAILED` : "\nall verb fixtures pass");
process.exit(fails ? 1 : 0);
