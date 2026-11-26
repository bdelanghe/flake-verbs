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

// Dotted declarations (`inputs.x.url = …`, `inputs.x.inputs.y.follows = …`)
// are declarations too — they must not count as uses.
const DOTTED = new URL("../fixtures/dotted", import.meta.url).pathname;
const dotted = await inputs.run({ root: DOTTED, unusedOnly: false, deep: false });
const dottedVerdict = (n: string) => dotted.inputs.find((i) => i.name === n)?.verdict;
expect("dotted: used is referenced", dottedVerdict("used"), "referenced");
expect("dotted: dead is unused", dottedVerdict("dead"), "unused");
expect("dotted: alsodead is unused", dottedVerdict("alsodead"), "unused");

const drift = await inputDrift.run({ root: ROOT, problemsOnly: false });
const statusOf = (n: string) => drift.inputs.find((i) => i.name === n)?.status;
expect("local is unportable", statusOf("local"), "unportable");
expect("unportable count", drift.summary.unportable, 1);
// github inputs must not be called unportable, whatever the network said
expect("used not unportable", statusOf("used") === "unportable", false);

console.log(fails ? `\n${fails} FAILED` : "\nall verb fixtures pass");
process.exit(fails ? 1 : 0);
