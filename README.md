# RGR

`rgr` is a no-dependency Red-Green-Refactor gate for coding agents. It gives agents a human-operator style CLI that records the failing test first, freezes that test with hashes and snapshots, and refuses to mark Green or Refactor if the Red test was edited.

## Install

This repo is private/local by design.

```bash
bun run src/cli/index.ts --help
```

From this repo:

```bash
bun run rgr -- --help
```

From another repo:

```bash
bun run /Users/saint/Dev/rgr-cli/src/cli/index.ts --root . --help
```

## Core Workflow

```bash
# 1. Initialize a manifest for this goal.
rgr init --goal-id billing-scope

# 2. Write only the failing test, then capture Red.
rgr red --goal-id billing-scope --cmd "bun test src/billing.test.ts"

# 3. Implement production code, then prove Green.
rgr green --cmd "bun test src/billing.test.ts"

# 4. Refactor only while the Red test is still byte-for-byte unchanged.
rgr refactor --cmd "bun test"

# 5. Final gate for local CI or sandbox authority.
rgr verify --ci --cmd "bun test"
```

Strict production workflow:

```bash
rgr red --strict --goal-id billing-scope --test src/billing.test.ts -- bun test src/billing.test.ts
rgr green
rgr refactor -- bun test
rgr verify --ci --replay -- bun test
```

Every run writes `.rgr/manifest.json`, `.rgr/events.jsonl`, snapshots, diffs, and command output logs.

## What It Enforces

- Red must fail.
- Red defaults to test-surface changes only.
- Red records protected test files with SHA-256 hashes and snapshots.
- Green refuses to run if any protected Red file changed.
- Refactor and Verify refuse to pass if protected Red files changed.
- Strict Red uses argv command proof instead of shell strings.
- Strict Green runs the exact Red command.
- Strict mode protects imported test helpers, fixtures, snapshots, package/test config, and lockfiles that can change what the test means.
- `verify --ci --replay` reconstructs the Red proof from the recorded git base commit and protected snapshots.
- Same-file multi-cycle work is supported through current protected heads: each Red hash is frozen through its Green, then a later Red can intentionally advance the file.
- Wrong tests must be superseded through `rgr revise-test`, then replaced by a new Red proof.
- `verify --ci` requires every active cycle to have Red and Green receipts.

## Threat Model

This tool gives honest agents and CI a deterministic contract. If an agent has unrestricted write access to the same repo, it can still delete `.rgr` or bypass the CLI. Treat local use as a discipline gate and make `rgr verify --ci --cmd "<full suite>"` mandatory inside CI, sandboxes, or agent harnesses when the result must be authoritative.

For authority, use strict replay:

```bash
rgr verify --ci --replay -- bun test
```

Legacy `--cmd` receipts remain useful for local discipline, but strict replay rejects them because arbitrary shell commands can fake failure or success.

## Test Discipline Prompt

Use:

```bash
rgr prompt
```

It prints a compact instruction block for agents that need to write meaningful tests instead of shallow mock-echo tests.
