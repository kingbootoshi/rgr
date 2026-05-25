# RGR

![RGR header](assets/rgr-header.png)

`rgr` is a no-dependency Red-Green-Refactor gate for coding agents. It gives agents a human-operator style CLI that records the failing test first, freezes that test with hashes and snapshots, and refuses to mark Green or Refactor if the Red test was edited.

## Install

Clone the repo and run it with Bun:

```bash
git clone https://github.com/kingbootoshi/rgr.git
cd rgr
bun run rgr -- --help
```

Optional: link the CLI onto your PATH:

```bash
bun link
rgr --help
```

From this repo:

```bash
bun run rgr -- --help
```

From another repo:

```bash
bun run /path/to/rgr/src/cli/index.ts --root . --help
```

The workflow examples below assume `rgr` is on your PATH. If it is not, replace `rgr` with `bun run /path/to/rgr/src/cli/index.ts`.

## Core Workflow

```bash
# 1. Initialize a manifest for this goal.
rgr init --goal-id billing-scope

# 2. Write only the failing test, then capture Red.
rgr red --strict --goal-id billing-scope --test src/billing.test.ts -- bun test src/billing.test.ts

# 3. Implement production code, then prove Green.
rgr green

# 4. Refactor only while the Red test is still byte-for-byte unchanged.
rgr refactor -- bun test

# 5. Final gate for local CI or sandbox authority.
rgr verify --ci --replay -- bun test
```

Every run writes `.rgr/manifest.json`, `.rgr/events.jsonl`, snapshots, diffs, and command output logs.

## What It Enforces

- Red must fail.
- Red defaults to test-surface changes only.
- Red records protected test files with SHA-256 hashes and snapshots.
- Green refuses to run if any protected Red file changed.
- Refactor and Verify refuse to pass if protected Red files changed.
- Every command proof uses argv after `--`, currently direct `bun test` only.
- Green runs the exact Red command.
- Strict Red protects imported test helpers, fixtures, snapshots, package/test config, and lockfiles that can change what the test means.
- `verify --ci --replay` reconstructs the Red proof from the recorded git base commit and protected snapshots.
- Same-file multi-cycle work is supported through current protected heads: each Red hash is frozen through its Green, then a later Red can intentionally advance the file.
- Wrong tests must be superseded through `rgr revise-test`, then replaced by a new Red proof.
- `verify --ci` requires every active cycle to have Red and Green receipts.

## Threat Model

This tool gives honest agents and CI a deterministic contract. If an agent has unrestricted write access to the same repo, it can still delete `.rgr` or bypass the CLI. Treat local use as a discipline gate and make `rgr verify --ci --replay -- bun test` mandatory inside CI, sandboxes, or agent harnesses when the result must be authoritative.

For authority, use strict replay:

```bash
rgr verify --ci --replay -- bun test
```

## Test Discipline Prompt

Use:

```bash
rgr prompt
```

It prints a compact instruction block for agents that need to write meaningful tests instead of shallow mock-echo tests.
