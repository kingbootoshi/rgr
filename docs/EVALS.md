# RGR Harness Evals

These evals are deterministic Tier 1 harness checks for the production RGR proof layers. There is no model judge in this suite.

## Goal

Prove that the strict RGR path rejects known bad agent behaviors and accepts honest Red-Green-Refactor flows.

## What Better Means

RGR is better when it prevents agents from moving, weakening, bypassing, or faking the Red proof while still allowing normal iterative TDD work.

## Observed Failure Modes

Traces came from the prior ledger dogfood run and current e2e suite:

- source code edited before Red
- source file passed as `--test`
- helper/config tampering after Red
- helper/fixture support passed incorrectly as `--test`
- Red command generating unprotected fixture/support files
- Green command changed from Red
- non-`bun test` command proof
- same-file multi-cycle work blocked by permanent hashes
- Red command mutating its own test oracle

## Tier 1 Checks

- command-proof: RGR rejects non-`bun test` command proof
- explicit-test-handling: `--test` only accepts root test files
- explicit-protected-support: `--protect` accepts helpers/fixtures/config support without making them assertion-bearing tests
- protected-scope: helper/config files that influence the Red test are protected
- green-command-lock: Green runs the exact Red command
- multi-cycle-hash-chain: same-file test extension works across Red-Green cycles
- red-self-mutation: Red commands cannot rewrite protected files while running
- red-generated-support: Red commands cannot create unprotected helper/fixture support while running
- quality-inspection: weak tests produce inspection warnings

## Tier 2

Not used. This harness has no generated AI output to judge. The quality layer is deterministic static inspection plus the Oracle rubric saved in the goal ledger.

## Tier 3

Human review should inspect new eval reports whenever a hardening layer changes. New failure cases should be added as deterministic checks first.

## Goodhart Shield

Outcome signal: eval checks pass.

Process signals: each check records command output and scenario-specific evidence.

Regularization constraints: no external dependencies, no shell proof path, no manual report edits during a run.

The Goodhart trap this avoids: agents optimizing for “tests pass” while weakening the command, test file, helper, config, or replay proof.
