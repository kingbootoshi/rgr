# Test Discipline

Good RGR only works when Red proves the behavior that matters.

RGR proves process integrity, not semantic test quality. A frozen weak test is still weak. Use strict RGR to prove the test did not move after Red, then use this document, `rgr inspect-test`, review, and dogfood evidence to judge whether the test was worth freezing.

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
rgr red --strict --goal-id <goal> --test <test-file> -- bun test <test-file>
```

That keeps the audit trail honest while allowing the spec to improve.

## Strict Harness Rule

For production agent work, prefer:

```bash
rgr red --strict --goal-id <goal> --test <test-file> -- bun test <test-file>
rgr green
rgr refactor -- bun test
rgr verify --ci --replay -- bun test
```

Strict mode rejects shell command proof, production files passed as `--test`, Green commands that differ from Red, protected helper/config tampering, and Red commands that rewrite their own test oracle.
