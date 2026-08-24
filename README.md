# flake-verbs

Flake-structure verbs, authored once as typed [verbspec](https://github.com/bounded-systems/verbspec)
specs and projected to CLI, MCP, Anthropic tool-use and OpenAPI.

Two questions this answers, both of which used to require reading a flake by hand:

| verb | question |
| --- | --- |
| `inputs` | Which of my inputs does anything actually use? |
| `input-drift` | How far has each locked input drifted from its upstream — and can it still be fetched at all? |

## Run

```sh
bun install
bun run src/cli.ts inputs ~/.config/home-manager
bun run src/cli.ts input-drift ~/.config/home-manager --problemsOnly
bun run src/cli.ts --mcp-tools          # the agent-facing surface, derived
```

Both verbs take the flake root as a positional (default `.`) and emit JSON;
the CLI renders a text view, every other surface consumes `output`.

## `inputs` — use vs. mention

The naive version of this is `grep <input-name> *.nix`, and it reports that
every input is used. Three things mention an input without depending on it:

- the `outputs = { a, b, … }:` parameter list, which *names* every input
- comments
- path and string literals — `./programs/lnzr.nix`, `"lnzr/.keep"`

String **interpolations** are the exception and must survive the filter, because
`"${dx-compose}/path/to/module"` is a genuine reference. That asymmetry is why
this can't be a grep.

The scan also follows `_module.args` aliases. A flake that binds
`synoptic = config._module.args.synoptic-github` uses the input under a
different word entirely, and missing that is how a live input gets pruned.

### The three verdicts

`referenced` and `unused` mean what they say. `module-import-only` is the
interesting one, and it is deliberately not called "unused": importing a Home
Manager module can be entirely load-bearing (the module sets config itself) or
a complete no-op (every option defaults false and nothing enables them).

With `--deep` (default on) the verb settles the case where it can: it resolves
the input to its store path via `nix flake archive`, reads the imported module,
recovers the option namespace it declares, and checks whether anything in the
consuming flake sets it. That turns a shrug into a fact:

```
DEAD dx-compose          github:bdelanghe/dx-compose
     imports a module declaring programs.devcontainers-cli, which nothing in this flake sets
```

Where it can't resolve a namespace it stays `module-import-only` rather than
guessing. A false `unused` is the expensive mistake — it deletes a working
input — so every step degrades toward "a human should look".

## `input-drift` — the one that pays for itself

`behind` is ordinary and not a failure. Two statuses are:

- **`unportable`** — a `path:` input. Nix re-reads path inputs from disk at
  evaluation time, so a lock pointing at a directory that exists only on the
  authoring machine makes the flake unevaluable anywhere else. This is a
  bootstrap dead-end that stays completely invisible until you try to build on
  a second machine.
- **`orphaned`** — the locked revision carries commits that are not on the
  remote's default branch, or the remote has never heard of it. The commit
  exists only in a local checkout: unpushed work that a machine rebuild
  discards silently.

Both exit non-zero, so this gates CI. `behind` does not.

Upstream queries go through `gh api`, so private inputs resolve without this
tool ever handling a token.

### Why it exists

Written after a real loss. A `home-manager` flake carried four `path:` inputs
pointing under `~/.local`; on a fresh machine the flake could not evaluate at
all. Repointing them at GitHub revealed that one, `lnzr`, had a local checkout
three months ahead of its remote `main` — work that existed nowhere else and
went with the old disk.

The lock had recorded both facts the whole time. Nothing could ask it.

## Limits worth knowing

- The reference scan is textual, not an evaluation. It reads `.nix` sources; it
  does not evaluate the flake, so an input reached only through generated or
  dynamically-constructed attribute paths can still be missed.
- `--deep` recognises the `cfg = config.<ns>` and `options.<ns>` idioms. A
  module written some other way falls back to `module-import-only`.
- `input-drift` only checks `github:` inputs against their upstream. `git:` and
  `tarball:` inputs report `unknown` rather than a wrong answer.
- Only *direct* inputs are examined. A transitive input is someone else's
  choice, to audit in their own repo.
