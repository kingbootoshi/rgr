# Test Discipline

Good RGR only works when Red proves the behavior that matters.

## Good Red Tests

- Exercise the public contract that production callers rely on.
- Assert a concrete outcome, state change, side effect, or error boundary.
- Include the tenant, auth, permission, time, concurrency, or persistence constraint when that constraint is part of the behavior.
- Fail for the reason the production change is meant to fix.
- Stay small enough to run as a focused command during Green.

## Bad Red Tests

- Mock-echo tests that only prove the mock returned the mock.
- Tests that assert `ok` without checking the meaningful payload.
- Tests that pass because implementation details were copied into the test.
- Snapshot-only tests where the behavioral expectation is not named.
- Tests that require editing production code before Red can fail.
- Setup failures disguised as Red: missing test imports, syntax errors, broken environment, missing secrets, or unrelated fixture boot failures.

## Revision Rule

When the test is wrong, do not quietly edit it during Green. Run:

```bash
rgr revise-test --reason "the first assertion described the wrong contract"
rgr red --goal-id <goal> --cmd "<focused command>"
```

That keeps the audit trail honest while allowing the spec to improve.
