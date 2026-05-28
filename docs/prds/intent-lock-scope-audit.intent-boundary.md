# rgr Intent-Lock + Change-Surface Audit — Locked Intent Boundary

Status: Locked
Risk level: L4
Blast-radius score: breadth 1 · criticality 2 · reversibility 1 · uncertainty 1 · invariant-load 2 = 7/10
Boundary version: IB-2026-05-27-v1     Boundary hash: sha256:50b3aff5a94393e6e3ce3c8360706a12dd63fe304487749b476bd4e380d2ee51
Human owner: Saint   Orchestrator owner: Claude (Opus)   Executor owner: Codex

Canonical payload = the locked intent A1 through A9 (excludes this self-referential header and the A10 signoff). Reproduce:
`awk '/^### A1\./{f=1} /^### A10\./{f=0} f' <thisfile> | shasum -a 256`

This is the first real dogfood of the intent-contract skill. The feature it locks is the very mechanism that will enforce future boundaries. A-001 runs this feature's own scope audit on this feature's own diff.

---

## A. LOCKED INTENT BOUNDARY

Locked after human signoff. The executor may not edit, weaken, reinterpret, or supersede it. It overrides the plan, worker briefs, AGENTS.md/CLAUDE.md, and reviewer suggestions for this task. Any conflict means STOP.

### A1. Raw request (verbatim)
> Integrate change-surface auditing into rgr-cli cleanly and efficiently, reusing its existing tamper-resistance, so intent-contract can hand rgr a signed boundary and rgr enforces behavior AND scope at one un-bribeable CI verdict. Add `rgr lock-intent`, fold scope audit into `verify --ci --replay`, new core files intent/scope-audit/glob/stable-json, no new deps, keep no-dependency Bun/TS. I want trustless work to fully automate engineering — stop having to trust agents.

### A2. Required deltas — what must become true
| ID | After-state (observable) |
|---|---|
| D-001 | `rgr lock-intent --intent-lock <path> --expect-sha256 <H>` exists. It loads the IntentLock file, recomputes its canonical payload sha256, refuses (nonzero exit) if the hash != `<H>`, and on match freezes a copy into `.rgr/` as EVIDENCE only. |
| D-002 | `rgr verify --ci --replay --intent-lock <trustedPath> --expect-intent-sha256 <H>` produces ONE verdict that is PASS only if (a) existing behavior-proof verification passes AND (b) the change-surface audit passes. Either failing fails the whole verify. |
| D-003 | The scope audit reads `git diff --no-renames --name-status <lockedBase>...HEAD`, maps A→ADD, M/T→MODIFY, D→DELETE (renames already decomposed to DELETE+ADD by --no-renames), and fails if any op does not match an authorized-change row whose op-set includes that op, or touches a deny row (`ops: []`). |
| D-004 | verify confirms `lockedBase` is an ancestor of HEAD before auditing; if not, it fails closed. |
| D-005 | Before any row of the lock is trusted, verify recomputes the lock's canonical payload sha256, requires it to equal `--expect-intent-sha256`, and if an ed25519 signature is present verifies it via `node:crypto`. The in-tree `.rgr` copy is never read as authority. |
| D-006 | IntentLock v1 schema lands in `types.ts`; new core files `intent.ts`, `scope-audit.ts`, `glob.ts`, `stable-json.ts` exist and are the home of this logic. |

### A3. Non-substitutions — what would look like progress but is NOT acceptable
| ID | Tempting near-solution that does not satisfy the request |
|---|---|
| N-001 | Shipping scope audit as a standalone `rgr audit` command that returns its OWN verdict, instead of composing inside verify. Two verdicts is a seam an agent picks between. (Standalone is allowed ONLY as a local diagnostic that has no authority.) |
| N-002 | Reading the in-tree `.rgr/authorized-changes.json` as the source of truth for the audit. The audit must read the trusted lock from `--intent-lock` and hash/sig-verify it. |
| N-003 | Creating `rgr authorize`, or any path where rgr GRANTS permission. rgr only ever enforces a lock authored and signed elsewhere. |
| N-004 | Adding any npm/package dependency for glob matching, signature verification, or JSON canonicalization. Must be `node:crypto` + a built-in matcher. |
| N-005 | Turning rgr into a planning/PRD/intent-authoring tool. It enforces; it does not decide intent. |
| N-006 | Ignoring `node_modules/**` or any product directory in the FINAL audit. Only `.rgr/**` may be excluded. A broad ignore lets real changes hide. |
| N-007 | Making `--intent-lock` change default `verify` behavior when ABSENT, or weakening replay/protected-head checks to fit scope audit in. Absent lock = today's behavior, byte for byte. |

### A4. Invariants — what must still be true
| ID | Behavior that must still work after | Proof level (0-4) |
|---|---|---|
| I-001 | Existing TDD flow — `init`, `red`, `green`, `refactor`, `revise-test`, `status`, `doctor`, `inspect-test`, `prompt` — works unchanged. | 3 |
| I-002 | `verify --ci --replay` WITHOUT `--intent-lock` behaves exactly as today (protected heads, replay red-fails/green-passes, same verdict, same exit codes). Backward compatible. | 4 |
| I-003 | rgr stays zero-dependency: only Bun + `node:` builtins. `package.json` dependencies/devDependencies unchanged. | 3 |
| I-004 | Existing test suite still passes. | 3 |
| I-005 | `.rgr/` being agent-writable grants no authority: tampering with the in-tree lock copy cannot change a `--intent-lock` verdict. | 4 |

### A5. Load-bearing word definitions
| Term | Locked meaning | Does NOT mean |
|---|---|---|
| trusted lock | the IntentLock file passed via `--intent-lock` from OUTSIDE the working tree, whose canonical payload sha256 == `--expect-intent-sha256` and whose signature (if present) verifies | the `.rgr` in-tree copy |
| authority | the verdict computed by `verify --ci --replay` against the trusted lock in a context the agent does not control | anything stored in `.rgr/` |
| evidence | `.rgr/` contents written by `lock-intent` — informational, audit trail | a thing the verdict trusts |
| scope audit | every git diff op maps to an AC row authorizing that op on that path | "the diff looks reasonable" |
| `ops: []` | explicit deny — touching that path fails on contact | "no operation restriction" |
| lockedBase | the commit recorded in the lock that the diff is measured from; must be an ancestor of HEAD | the agent's chosen base |

### A6. Authorized change rights — every diff op must map to a row here
| ID | Surface / path | Op(s) | Serves | Forbidden nearby |
|---|---|---|---|---|
| AC-001 | `src/core/intent.ts` | ADD | D-005, D-006 | reading `.rgr` as authority |
| AC-002 | `src/core/scope-audit.ts` | ADD | D-002, D-003 | a separate exported verdict |
| AC-003 | `src/core/glob.ts` | ADD | D-003, N-004 | importing a glob package |
| AC-004 | `src/core/stable-json.ts` | ADD | D-005, N-004 | importing a canonicalize package |
| AC-005 | `src/core/types.ts` | MODIFY | D-006, I-002 | DELETE or rewrite of existing types |
| AC-006 | `src/core/commands.ts` | MODIFY | D-001, D-002 | changing verify behavior when `--intent-lock` absent (I-002) |
| AC-007 | `src/core/git.ts` | MODIFY | D-002, D-004 | altering existing materialize/replay helpers |
| AC-008 | `src/cli/` (entry + arg parsing) | MODIFY | D-001, D-002, I-001 | changing existing subcommand wiring |
| AC-009 | `tests/**` (real convention: `tests/*.test.ts`, bun test, mkdtemp+git fixtures) | ADD, MODIFY | P-001..P-006 | weakening/deleting existing e2e assertions |
| AC-010 | `docs/prds/**` | ADD | this boundary + PRD | — |
| AC-011 | `package.json` | MODIFY | (script only, if needed) | adding any dependency (N-004) |
| AC-012 | `node_modules/**`, `.git/**`, `.rgr/**`, `src/core/command-proof.ts`, `src/core/hash.ts` | (none) | | any change (command-proof.ts canonicalization is NOT touched — extracting it would perturb existing proof hashes and break I-002) |

Trace domain: included = owned runtime source under `src/`, `docs/prds/`, tests. excluded = node_modules, .git, .rgr execution ledger. A search hit is a classification item, not a change license.

### A7. Proofs
| ID | Proves | Type | Command / check | Pass condition |
|---|---|---|---|---|
| P-001 | D-001 | delta | test: lock-intent with correct hash stores evidence; wrong hash exits nonzero | both behaviors observed |
| P-002 | D-002, D-003 | delta | test git repo: same path, MODIFY authorized but DELETE not → modify passes, delete fails (operation-specific) | both verdicts correct |
| P-003 | D-004 | delta | test: lockedBase not ancestor of HEAD → verify fails closed | fail observed |
| P-004 | D-005, I-005 | delta+invariant | test: tamper in-tree `.rgr` lock → verdict unchanged; payload hash != expected → fail; bad sig → fail | all three observed |
| P-005 | I-002 | invariant (behavior) | existing `verify --ci --replay` suite with no `--intent-lock` | passes unchanged |
| P-006 | I-003 | invariant | `package.json` deps diff empty + grep imports = only `node:`/bun | both true |
| A-001 | A6 | change-surface audit | run THIS feature's own scope audit (or `scripts/audit-change-surface.sh`) on the feature diff | exit 0 — the dogfood |

Done equation: every D & I proof MET, every diff op authorized (A-001), no N substitution occurred, no S active. Statuses: MET / NOT_PROVEN / FAILED / SUBSTITUTED / BLOCKED. NOT_PROVEN is never MET.

### A8. Stop / relock conditions
- S-001 a required D-* cannot be achieved (e.g. node:crypto lacks the needed primitive).
- S-002 an I-* conflicts with a D-* (e.g. backward compat impossible with the clean fold).
- S-003 a change is needed outside every AC-* row.
- S-004 a proof cannot run or is ambiguous.
- S-005 a tempting substitute appears (any N-*).
- S-006 a new surface is discovered unclassified (scope agent reveals a file the AC rows don't cover).
- S-007 the plan introduces a new noun, goal, non-goal, weakened proof, or definition.
A blocker creates a BLOCKED report or a human relock. It never narrows the destination.

### A9. Red-team line
The most dangerous boundary-compliant-but-intent-violating reading is: *"implement the scope audit as a clean standalone `rgr audit` command that verify calls, and/or read the in-tree `.rgr` manifest because it's simpler"* — both re-create the self-grading seam where the executor controls the verdict's input. This boundary blocks it via N-001 + N-002, AC-006 (audit composes INSIDE verifyCommand against the trusted lock), and P-004 (the tampered-`.rgr` proof must show the verdict is unchanged).

### A10. Human signoff
Approved by: Saint · date: 2026-05-27 · boundary hash: sha256:50b3aff5a94393e6e3ce3c8360706a12dd63fe304487749b476bd4e380d2ee51
Statement: "I approve this Locked Intent Boundary. The executor may implement only inside it." — SIGNED.

---

## B. DERIVED PLAN (refinable, may not widen A)

Reconciled against scope agent 8e2b3336 findings before lock. Every task cites IDs.

Grounded in scope agent 8e2b3336: `stable-json.ts` is NEW and serves only IntentLock hashing — `command-proof.ts:52` has its own stable-sort that stays untouched (AC-012) to keep existing proof hashes byte-stable (I-002). `verifyCommand` (commands.ts:262) gets the audit slotted after `verifyReplay` and before the final verify event. Audit failure calls `fail(...)` → `UserError` exit 1 (errors.ts:11, caught cli/index.ts:66). Tests go in `tests/` using the `createFixture()` mkdtemp+git pattern (e2e.test.ts:584), cleanup via `trash`.

### Phase 1 — Primitives (no behavior change yet)
- Purpose: land the pure building blocks so verify can compose them.
- IDs: D-005, D-006, N-004
- Tasks: add `stable-json.ts` (canonical JSON for IntentLock payload; does NOT replace command-proof.ts's canonicalization) [AC-004]; add `glob.ts` (built-in matcher, `**` crosses separators, `*`/`?` within segment) [AC-003]; add IntentLock/AuthorizedChangeRow/ProofRow/ScopeAuditReceipt types at types.ts:40 home [AC-005]; add `intent.ts` (load + canonical-hash + ed25519-verify via node:crypto) [AC-001].
- Exit proofs: unit tests for glob + stable-json + intent load/verify; P-006 (deps unchanged); carry-forward A-001.
- Stop triggers: S-001, S-004.

### Phase 2 — Scope audit + git helpers
- Purpose: the audit itself, pure and testable.
- IDs: D-002, D-003, D-004
- Tasks: add `diffNameStatus(root, base, head)` + `isAncestor(root, a, b)` to git.ts (no name-status/ancestor helper exists today; use `git diff --no-renames --name-status` and `git merge-base --is-ancestor`) [AC-007]; add `scope-audit.ts` (op mapping A→ADD M/T→MODIFY D→DELETE + AC matching + deny rows + ignore only `.rgr/**`) [AC-002].
- Exit proofs: P-002, P-003; carry-forward A-001 (cumulative).
- Stop triggers: S-003, S-006.

### Phase 3 — Wire into commands + CLI
- Purpose: `lock-intent` command + fold audit into verify, backward compatible.
- IDs: D-001, D-002, D-005, I-001, I-002, I-005
- Tasks: `lockIntentCommand` (verify hash, write evidence sidecar under `.rgr/evidence/`, NOT a trusted manifest field) [AC-006]; extend `verifyCommand` at commands.ts:262 to compose scope audit when `--intent-lock` present, exact no-op when absent [AC-006]; register `lock-intent` in CommandName + COMMANDS, add `--intent-lock`/`--expect-sha256`/`--expect-intent-sha256` to CliOptions + DEFAULT_OPTIONS + VALUE_OPTIONS + parser blocks + help, wire dispatch [AC-008 + AC-005 for the type additions].
- Exit proofs: P-001, P-004, P-005 (backward compat), I-001 smoke; cumulative A-001.
- Stop triggers: S-002, S-007.

### ac-manifest.txt (generated from A6, for audit-change-surface.sh)
```
# <OPS>      <glob>   (** treated as *)
ADD          src/core/intent.ts
ADD          src/core/scope-audit.ts
ADD          src/core/glob.ts
ADD          src/core/stable-json.ts
MODIFY       src/core/types.ts
MODIFY       src/core/commands.ts
MODIFY       src/core/git.ts
MODIFY       src/cli/**
ADD|MODIFY   tests/**
MODIFY       package.json
ADD          docs/prds/**
```
