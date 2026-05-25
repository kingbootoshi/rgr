---
name: rgr
description: "Use RGR for strict Red-Green-Refactor work in Claude Code or Codex when a code change should prove the test failed before implementation, protect that Red test from silent edits, prove Green with the same command, and finish with replay verification."
---

# RGR

## Outcome

Goal: ship code changes through strict Red-Green-Refactor proof.

Success means:
- A behavior-focused test fails before production code changes.
- RGR records the Red failure, protected test surface, snapshots, hashes, command proof, and evidence.
- Green uses the exact Red command through `rgr green`.
- Refactor and final verification pass with protected Red files unchanged.
- Goal-style work records the cycle id, protected files, evidence paths, and final verification result.

Stop when every active RGR cycle has Green, `rgr verify --ci --replay -- bun test` passes, and the final response reports the proof.

## Resolve the CLI

Use this order in Claude Code and Codex:

1. Run `rgr --help`. Claude Code installs this plugin's `bin/rgr` wrapper onto `PATH`, so this should work when the plugin is enabled.
2. If you are inside a clone of this repository, run `bun run ./src/cli/index.ts --help`.
3. If the user or environment provides `RGR_CLI`, run `bun run "$RGR_CLI" --help`.

If none of those works, stop and ask the user to install or link RGR before making production changes. Do not simulate RGR receipts by hand.

Use `rgr` in the examples below. Replace it with `bun run ./src/cli/index.ts` or `bun run "$RGR_CLI"` only when needed.

## Command Shape

Capture Red:

```bash
rgr --root "$REPO" red --strict --goal-id "<goal-id>" --test "<test-file>" -- bun test "<test-file>"
```

Protect a helper, fixture, snapshot, or config file that defines the Red oracle:

```bash
rgr --root "$REPO" red --strict --goal-id "<goal-id>" --test "<test-file>" --protect "<support-file>" -- bun test "<test-file>"
```

Prove Green:

```bash
rgr --root "$REPO" green
```

Inspect test quality:

```bash
rgr --root "$REPO" inspect-test --json
```

Validate refactor:

```bash
rgr --root "$REPO" refactor -- bun test
```

Run the final gate:

```bash
rgr --root "$REPO" verify --ci --replay -- bun test
```

## Workflow

1. Orient on the requested behavior and public contract.
2. Check the worktree so existing user edits are visible before Red.
3. Choose the narrowest meaningful behavior test that proves the request.
4. Write or update only the root test and any needed helper, fixture, snapshot, or test config.
5. Run `rgr red --strict` with the focused test file.
6. Read the Red failure and confirm it points at the intended behavior.
7. Edit production code only after Red is captured.
8. Run `rgr green` to prove the exact Red command now passes.
9. Run `rgr inspect-test --json`; revise weak or wrong tests through `rgr revise-test`.
10. Run `rgr refactor -- bun test` after Green for broader validation.
11. Run `rgr verify --ci --replay -- bun test` before handoff.
12. Report cycle ids, protected files, evidence paths, and verification output.

Use `--test` only for root assertion-bearing tests. Use `--protect` for support files that change what the Red test means. Do not pass helpers or fixtures as `--test`.

## Good Red Tests

Choose tests that exercise the public contract callers rely on. Assert a concrete payload, state change, side effect, permission boundary, persistence result, error boundary, or emitted event.

Include tenant, auth, permission, time, ordering, persistence, concurrency, and rollback constraints when those define correctness.

Use mocks at external seams only. Keep assertions pointed at behavior the production caller observes: returned payloads, state transitions, side effects, emitted events, and errors.

Prefer one focused Red for the next behavior step. Add broader integration or e2e coverage when the risk crosses service boundaries, storage, auth, routing, or user workflow.

## Failure Routing

When Red passes, strengthen the test until it proves missing behavior and fails cleanly.

When Red fails from setup noise, repair the test setup and rerun Red before production edits.

When the test is wrong, run:

```bash
rgr --root "$REPO" revise-test --reason "<why the old Red was wrong>"
```

Then capture a new Red proof.

When a protected file changes during Green, restore your own accidental edit or supersede the cycle through `revise-test` and recapture Red.

When a same-file multi-cycle change extends a test file after Green, checkpoint the prior Green state before capturing the next Red so CI replay has a stable base.
