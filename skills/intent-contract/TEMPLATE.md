# Locked Intent Boundary — fill-in template

Copy into `docs/prds/<goal>.intent-boundary.md`. Section A (the boundary) locks at human signoff. Section B (the plan) is derived and refinable but may never widen or add intent to A.

```
# <Goal> — Locked Intent Boundary

Status: Draft | Locked | Re-Lock Required | Blocked | Complete
Risk level: L0 | L1 | L2 | L3 | L4 | L5
Blast-radius score: breadth_ criticality_ reversibility_ uncertainty_ invariant-load_ = _/10
Boundary version: IB-<date>-v<n>     Boundary hash: <generated at lock>
Human owner / Orchestrator owner / Executor owner:
```

---

## A. LOCKED INTENT BOUNDARY

Locked after human signoff. The executor may not edit, weaken, reinterpret, or supersede it. It overrides the plan, worker briefs, global AGENTS.md/CLAUDE.md, and reviewer suggestions for this task. Any conflict means STOP.

### A1. Raw request (verbatim)
> <paste exact original request>

### A2. Required deltas — what must become true
| ID | After-state (observable) |
|---|---|
| D-001 | |

### A3. Non-substitutions — what would look like progress but is NOT acceptable
| ID | Tempting near-solution that does not satisfy the request |
|---|---|
| N-001 | |

### A4. Invariants — what must still be true (preserve by claim, not "do not touch")
| ID | Behavior that must still work after | Proof level (0-4) |
|---|---|---|
| I-001 | | |

### A5. Load-bearing word definitions
| Term | Locked meaning | Does NOT mean |
|---|---|---|
| | | |

### A6. Authorized change rights — every diff op must map to a row here
| ID | Surface / path | Op(s) ADD/MODIFY/DELETE | Serves (D/I) | Forbidden nearby |
|---|---|---|---|---|
| AC-001 | | DELETE | D-001 | |
| AC-002 | | MODIFY | I-001 | DELETE |
| AC-003 | node_modules/** , .git/** | (none) | | any change |

Trace domain (for any "remove all references" delta): included = owned runtime source, active config/CI, actively-read docs. excluded = node_modules, .git, archived docs, execution ledgers. A search hit is a classification item, not a deletion license.

### A7. Proofs
| ID | Proves | Type | Command / check | Pass condition |
|---|---|---|---|---|
| P-001 | D-001 | delta | | |
| P-002 | I-001 | invariant (behavior, not "exists") | | |
| A-001 | A6 | change-surface audit | authoritative: `rgr verify --ci --replay --intent-lock <trusted> --expect-intent-sha256 <H>` · fallback: `scripts/audit-change-surface.sh ac-manifest.txt <base>` | pass / exit 0 |

Done equation: every D & I proof MET, every diff op authorized (A-001), no N substitution occurred, no S condition active. Statuses: MET / NOT_PROVEN / FAILED / SUBSTITUTED / BLOCKED. "NOT_PROVEN" is never "MET".

### A8. Stop / relock conditions
- S-001 a required D-* cannot be achieved (e.g. missing primitive).
- S-002 an I-* conflicts with a D-*.
- S-003 a change is needed that lacks an AC-* authorization.
- S-004 a proof cannot run or is ambiguous.
- S-005 a tempting substitute appears (an N-*).
- S-006 a new surface is discovered and is unclassified.
- S-007 the plan introduces a new noun, goal, non-goal, weakened proof, or definition.
A blocker creates a BLOCKED report or a human relock. It never narrows the destination.

### A9. Red-team line
The most dangerous boundary-compliant-but-intent-violating reading is: <X>.
This boundary blocks it via: <AC rows + proofs + non-substitution>.

### A10. Human signoff
Approved by · date · boundary hash · statement:
"I approve this Locked Intent Boundary. The executor may implement only inside it."

---

## B. DERIVED PLAN (refinable, may not widen A)

Every task cites IDs. A task with no D/I/AC/P IDs is out of scope. The plan schedules implementation; it never adds intent. Plan/boundary conflict → `BLOCKED: plan/boundary contradiction`.

### Phase <n> — <name>
- Purpose:
- IDs in scope: D-* I-* AC-* P-*
- Tasks: <task> [IDs: ...]
- Exit proofs: P-* + carry-forward A-001 (cumulative diff) + touched-invariant smokes
- Stop triggers: S-*

### ac-manifest.txt (for the audit script — generated from A6)
```
# <OPS>  <glob>   (** treated as *)
DELETE       supabase/**
MODIFY|ADD   apps/api/src/db/**
MODIFY       apps/api/src/features/email/**
```
```
