# Decisions

Choices made where the spec (Doc 01 and Master Design §2) is silent, each with one line of reasoning, plus every change to a golden transcript and its reason. Christopher reviews this file at each checkpoint.

## Tooling

- **TypeScript 6.0, not 7.** typescript-eslint 8.72 supports TypeScript below 6.1. Move to 7 when it does.
- **pnpm 12 with a 14-day `minimumReleaseAge`.** A newly published package version can't be installed until it has been public for two weeks, which guards a new repository against compromised releases.
- **No build step.** Workspace packages export their TypeScript sources, and Node 24 strips types when it runs the conformance CLI, so the same files serve the Worker, Node and Vitest.

## Language and runtime

- **"Spaces" means U+0020 only**, wherever Doc 01 trims or skips spaces: TRIM$ (which says so), VAL's leading spaces and INPUT's field trimming. One rule is easier to reproduce in Rust than two.
- **Hex above 2^53 - 1 is out of range wherever the shared numeric grammar is used**, not just in literals: VAL raises ?OV, INPUT says ?REDO FROM START, and a DATA item is a compile-time ?OV. The grammar then means the same thing everywhere.
- **Every count and position is truncated toward zero** (MID$'s start and length, INSTR's start, STRING$'s count and so on), as the table says for LEFT$. Several rows of Doc 01 §12 don't repeat it.
- **MIN and MAX keep the earliest argument on a tie.** That decides 0 against -0 the same way in JavaScript and Rust, whose `f64::min` may return either.
- **STRING$ and SPACE$ raise ?OM above 16,777,216 characters,** the same limit as arrays. String `+` isn't checked, for the reason Doc 01 §5 gives for arithmetic; a host string-length failure there surfaces as ?OM.
- **ROUND keeps the sign of `x`,** so `ROUND(-0.4)` is -0, which PRINT shows as `0`. Rust's parse of `"-0"` gives the same.

## Golden changes

None yet.

## Deferred

Features that came up and were left out because Doc 01 doesn't list them.
