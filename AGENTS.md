# RGR Agent Instructions

Use this repository through the `rgr` CLI.

Before changing production code for a behavior change:

1. Write or update the smallest behavior-focused test that should fail.
2. Run `bun run rgr -- red --goal-id <goal> --cmd "<focused test command>"`.
3. Change production code only after Red is captured.
4. Run `bun run rgr -- green --cmd "<same focused test command>"`.
5. Refactor only after Green.
6. Run `bun run rgr -- verify --ci --cmd "<full validation command>"` before handoff.

Do not edit protected Red tests to make Green pass. If the test is wrong, run `rgr revise-test --reason "<why>"`, then capture a new Red cycle.
