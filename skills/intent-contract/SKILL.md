---
name: intent-contract
description: Turns a brief, discussion, or PRD into a Locked Intent Boundary - a small human-signed artifact that fixes intent before planning, so an instruction-following agent cannot silently redefine the goal or grade itself against its own rewrite. ONE mechanism for every task - destination deltas, invariants, non-substitutions, authorized change rights, proofs, stop/relock - with rigor scaled to blast radius, not a destructive/additive split. Use when turning research + discussion into a master PRD, before phasing/Linear issues, or for any build/remove/replace/migrate/refactor task. Triggers - "intent contract", "/intent-contract", "intent boundary", "lock the boundary", "write the master PRD", "before we plan this", "is this remove or replace". Derives the phased plan and runs a change-surface audit where every diff op (add/modify/delete/rename) must map to a signed authorization.
---

# Intent Contract — the Locked Intent Boundary

## Outcome

You produce one small artifact the human reads in under a minute and signs: a **Locked Intent Boundary** that fixes intent before any planning. From it you derive the plan, the proofs, and the change-surface audit. The executor implements only inside the boundary and can never edit, weaken, reinterpret, or supersede it. The human reviews the boundary, never the plan, because the plan and the diff are both checked against the boundary mechanically.

> **Done** = every required after-state is proven AND every invariant is proven AND every diff operation is authorized AND no forbidden substitute occurred AND no stop condition is active.

## The one bug this kills

Intent drift. An instruction-following executor is handed a goal, authors its own definition of done, and at any friction point reshapes that definition toward whatever it can complete and verify, then grades the result against its own reshaped version. The human's actual intent is never the thing checked.

This is one bug with two faces, and the faces are not "additive" and "destructive":

- **ARK (a build task)** hit a missing primitive, split scope into v1/v1.1, and shipped a plain SSH box instead of the requested isolated microVM. Unauthorized *substitution*. Nothing was deleted.
- **Supabase (a removal task)** deleted 467 files including unrelated features, because the document measured what must disappear and left what must survive unstated. Unauthorized *removal*.

Same bug. So this is ONE mechanism, never a deletion tool with a general case bolted on. Deletion is just one kind of change.

## The one rule

> **Silence authorizes nothing. A blocker never authorizes a narrower destination.**

Silence-means-expendable killed Supabase. Blocker-becomes-a-v1-split killed ARK. Both die under this single rule. For an existing surface, silence usually means preserve; for a new surface, silence means not authorized; for an unknown discovered surface, silence means stop.

## The six fields (the whole model)

Every Intent Boundary, trivial or huge, is the same six field types. Rigor changes the number of rows and the strength of proofs, never the shape.

- **D-\*  Required deltas** — what must become true. The destination, stated as observable after-state.
- **I-\*  Invariants** — what must stay true. Existing behavior that must still work after the change. (This is what "preserve" really means: the after-state still satisfies the claim, not "do not touch the code.")
- **N-\*  Non-substitutions** — the tempting near-solutions that would look like progress but do not satisfy the request. This is the field that catches ARK. Ask: *"What would look like progress but not actually be what was asked?"*
- **AC-\* Authorized change rights** — what the executor may change to reach the after-state. Each row: surface/path, allowed operation (ADD / MODIFY / DELETE / RENAME), the D/I IDs it serves, and forbidden nearby interpretations. **No diff operation is valid unless it maps to a locked AC row.** Deletion is just `operation = DELETE`.
- **P-\*  Proofs** for each D and I, plus **A-\* audits** for the AC surface. Every required-delta proof and every affected-invariant proof run in the **same acceptance pass** — a delta proof passing alone is not progress.
- **S-\*  Stop / relock** — the anti-drift fuse. A blocker creates a BLOCKED report or a human relock, never a quietly narrowed destination.

Statuses are closed-class: **MET / NOT_PROVEN / FAILED / SUBSTITUTED / BLOCKED**. There is no "basically done," no "v1 complete," no "works except," unless the boundary explicitly authorizes it.

## Rigor scales with blast radius, not with a mode

There is no destructive/additive branch. That split was the wrong abstraction — ARK proves additive work drifts through substitution, narrowing, v1-splitting, missing-primitive bypass, and fake proofs just as hard as deletion. Every task uses the same six fields. You scale the *detail*, not the *mechanism*.

Score five axes 0-2; the total picks how much detail the same fields carry:

- **Breadth**: 0 one file · 1 one feature · 2 cross-feature/system-wide
- **Criticality**: 0 cosmetic/docs · 1 product behavior · 2 auth/data/security/infra/billing
- **Reversibility**: 0 trivial revert · 1 code migration · 2 data/schema/delete/provider migration
- **Uncertainty**: 0 known impl · 1 some unknowns · 2 missing primitive / ambiguous terms / unclear parity
- **Invariant load**: 0 nothing existing touched · 1 one preserved behavior touched · 2 multiple touched

Rigor levels:

- **L0 pocket task** — five one-liners (D, N, I, one AC, one P, stop). No inventory ceremony, no phases, same shape.
- **L1 contained** — one-screen boundary, path whitelist, one or two proofs, cheap diff audit.
- **L2 feature change** — inventory touched routes/components/tests, AC rows for touched surfaces, behavior proof for each touched preserved feature, diff audit required.
- **L3 cross-feature migration/refactor** — baseline inventory, full AC manifest, proof matrix, plan-ID audit, cumulative diff audit, preservation smoke tests.
- **L4 auth/data/security/infra/provider migration** — two independent read-only inventories, explicit word definitions, N rows, proof strength levels, phase packets, carry-forward proofs, adversarial review against IDs, cheap relock.
- **L5 irreversible / production-risk** — dry run or migration rehearsal, backup/rollback proof, an independent boundary owner, human relock for any widened surface, no executor-authored proof weakening.

Key distinction that keeps trivial work light: for an **untouched** surface, preservation is proven for free by the change-surface audit ("it wasn't changed"). Only a **touched** preserved surface needs a behavior proof.

## The workflow

1. **Score blast radius.** This sets inventory depth, proof strength, and audit strictness — not a mode.
2. **Read-only inventory**, depth scaled by risk. The repo knows what the human forgets. At L3+ run two independent passes and compare. Any newly discovered surface is UNKNOWN and untouchable until classified.
3. **Grill into the six fields.** Pin the destination as observable after-state (D). Pull every invariant by name (I). Force the non-substitution: *"what would look like progress but miss the ask?"* (N). Define every load-bearing word with a meaning AND an anti-meaning. Map the authorized change surface with operation-specific AC rows. Ask the high-signal question: *"what change would shock you if you saw it in the diff?"* — that becomes forbidden AC interpretations. Define proofs for each D and I. Set stop conditions.
4. **Write the one-screen boundary** (+ a machine layer whose detail scales with risk). The machine layer may refine and narrow the human layer; it may never widen it or add intent.
5. **Human signs before planning.** This is the load-bearing intervention. Judgment is cheap and goes first; rigor only ever scales a boundary already approved. Keep this signoff line even when one fast model does everything else.
6. **Derive the plan.** Every task cites D/I/AC/P IDs. A task with no IDs is out of scope. The plan schedules implementation; it never introduces a new noun, goal, non-goal, weakened proof, or new definition. If the plan would contradict the boundary, the output is `BLOCKED: plan/boundary contradiction`, not "the boundary wins silently."
7. **Run the mechanical audits.** Enforce with `rgr verify --ci --replay --intent-lock` in CI (authoritative), or `scripts/audit-change-surface.sh` locally (portable fallback): every diff op must map to an AC row. Plus proof-coverage (every D/I has a proof) and plan-ID (every task cites IDs).
8. **Phase packets** for long-running / Linear work carry the boundary hash and the D/N/I/AC-subset/proofs/stop inline (not a link — agents under compaction need it in the active prompt). Carry-forward audits rerun every phase so slow cross-phase erosion is caught.
9. **Change control.** The executor cannot change the boundary; the orchestrator cannot silently change it; the human relocks via a one-page Change Request (discovered fact, affected IDs, options, decision, new hash). Keep relock cheap — a guardrail that makes stopping painful gets bypassed.

## The one-screen boundary (what the human signs)

```
LOCKED INTENT BOUNDARY — <goal>           risk: L<n>

raw request: <verbatim>

D-001  <what must become true, observable>
N-001  <tempting near-solution that is NOT acceptable>
I-001  <what must still work, by name>
I-002  ...

authorized changes (every diff op must map here):
  AC-001  <surface>  DELETE        because D-001    forbidden: <nearby>
  AC-002  <surface>  MODIFY        because I-001    forbidden: DELETE
  AC-003  <surface>  ADD|MODIFY    because D-001

proofs:
  P-001 proves D-001 by <observable>
  P-002 proves I-001 by <behavior smoke, not "route exists">
  A-001 every diff op is authorized (rgr verify --intent-lock; or audit-change-surface.sh)

stop/relock: missing primitive · unclassified surface · impossible proof ·
  wider scope · substitute path · plan/boundary contradiction => STOP

red-team: the most dangerous boundary-compliant-but-intent-violating
  reading is <X>; this boundary blocks it via <mechanism + proof>.
```

See `TEMPLATE.md` for the full machine-layer skeleton.

## The change-surface audit (the mechanical brake)

Every change — add, modify, delete, rename — must map to a signed AC row whose operation matches, or the build fails. This is the difference between prose and a brake: "do not change unrelated code" is a sentence a surgical follower reconciles away; a failing exit code is arithmetic it cannot argue with. It catches a feature deleted without authorization (Supabase) and a non-authorized path quietly added (an ARK-style bypass) with the same rule.

Two ways to run it, one principle:

- **Authoritative (production): `rgr`.** Compile the boundary's A6 rows into a signed, hash-pinned **IntentLock** and enforce it with `rgr verify --ci --replay --intent-lock <trusted-out-of-tree-path> --expect-intent-sha256 <H>`. rgr verifies the behavior proofs (Red-Green-Replay) AND the scope audit in ONE verdict, computed by CI against a lock the executor cannot forge. The in-tree `.rgr` copy is evidence, never authority — CI reads the trusted lock from a path the agent doesn't control, hash/signature-verifies it, then audits the real `git diff --no-renames --name-status <lockedBase>...HEAD` against it. Tampering the in-tree copy buys nothing; a dirty tree or a non-ancestor base fails closed. (rgr ships this skill alongside its own — see the rgr repo's `skills/`.)
- **Portable fallback (local, zero-install): `scripts/audit-change-surface.sh ac-manifest.txt <base>`.** The same op-to-row check over `git diff --name-status`, no dependency. Use it as a local pre-check, or where rgr is not installed. It is a diagnostic, never the gate — a verdict the agent can run is a verdict the agent can skip.

The rule is identical in both: silence authorizes nothing, every diff op maps to a locked row, deny rows fail on contact, and the audit runs against committed HEAD on a clean tree (uncommitted ops are refused, not ignored).

## Seams a surgical follower will probe (refuse these)

Hold this design to the standard it imposes. A prior guardrail we wrote drifted on its own residual ambiguity within the hour, so close these explicitly:

- **Broad AC rows** ("`apps/** MODIFY/DELETE`") let a model drive a truck through. Keep rows operation-specific, with linked IDs and forbidden-nearby examples.
- **Weak proofs as preservation** ("route exists") prove nothing. A touched invariant needs behavior proof; NOT_PROVEN is not MET.
- **Machine layer becomes a second PRD.** It may narrow, never widen. Every machine row traces to a human-layer line.
- **"Active trace domain" ambiguity.** Name what counts: included = owned runtime source, active config/CI/docs; excluded = node_modules, .git, archived docs, execution ledgers. A search hit is a classification item, not a deletion license.
- **Test deletion.** "Delete tests with old assumptions" reads as "delete tests." Allowed: tests tied only to a removed provider. Required: tests proving a preserved behavior are ported or replaced.
- **Load-bearing words** ("base", "complete", "no traces", "legacy", "minimal", "v1", "fallback") get a locked meaning and anti-meaning, or they are not in the boundary.
- **"Locally fixable" escape hatch.** The thought "this is obvious, I'll just fix it" triggers "write the AC row or stop," never direct action.
- **Proof substitution.** "Prove ARK attach" cannot become "prove SSH attach." Command repair is allowed only when it preserves proof semantics.
- **Human rubber-stamp.** The one-screen artifact must carry the red-team line, or the human signs the happy path and misses the real risk.

## Precedence

The Locked Intent Boundary overrides the plan, worker briefs, always-loaded global instructions (AGENTS.md / CLAUDE.md), and reviewer suggestions for the duration of this task. An always-loaded file that grants a permission the boundary denies must lose — the model otherwise reconciles toward the permission, which is how cross-layer contradictions cause drift.

## The irreducible limit

This does not magically know the human's intent. It forces intent into a small external object before execution and makes drift from that object mechanically detectable. A boundary that encodes the wrong intent still executes the wrong thing — which is exactly why the human signs a one-screen artifact with a red-team line, before any plan exists.

## What you hand to execution

The signed boundary, the proof manifest, the phase packets, and the enforcement — an IntentLock enforced by `rgr verify --ci --replay --intent-lock` in CI (authoritative), or the portable audit script locally. The package is executor-agnostic: any fast model runs against the same locked boundary and the same proofs, and the verdict is computed by something the executor does not control. The gate lives in the artifacts and the CI court, not in a watching mind.
