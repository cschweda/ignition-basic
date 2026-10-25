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
- **A string a program builds may hold at most 16,777,216 characters,** the same limit as arrays. STRING$, SPACE$ and string `+` raise ?OM beyond it. `+` was at first left unchecked, like arithmetic (Doc 01 §5), but the IDE runs programs from share links, and a doubling loop would otherwise grow to about a gigabyte in the Worker before the engine refused. The check costs nothing until the UTF-16 length passes the limit. Text typed at INPUT isn't capped; the person typing controls it. Any other host string-length failure also surfaces as ?OM.
- **ROUND keeps the sign of `x`,** so `ROUND(-0.4)` is -0, which PRINT shows as `0`. Rust's parse of `"-0"` gives the same.
- **Spaces or tabs may come before a line number.** Doc 01 says a line starts with its number; indented listings are common and allowing them changes no program's meaning.
- **A keyword needs a non-name character after it, not before it,** exactly as Doc 01 §3 states it. So `FOR I = 1TO 10` lexes as `1`, `TO`, `10`, while `FORI=1TO10` is still the identifiers `FORI` and `TO10`.
- **A comment after `THEN n` or `ELSE n` is a statement of its own after the IF,** since no branch statements exist for it to join.
- **`DATA` with nothing after it declares one empty-string item,** the same way the gap in `DATA 1,,3` does.
- **Each statement's position is its first token; each operator's node takes the operator's position,** so a type error points at the `+` that caused it.
- **PRINT evaluates all of its items, left to right, before printing any of them.** An error in one item therefore prints nothing from that PRINT (`PRINT "1 / X IS "; 1 / X` shows only the error), and TAB's argument is checked during evaluation. Phase 3 can then emit a PRINT as one runtime call, `io.print(a, b, c)`, which evaluates its arguments the same way in JavaScript and Rust.
- **Example 10 covers all ten runtime errors**, not just the three the plan names (/0, BS, RG), because its title promises every one.
- **`^` is JavaScript's `**`** (ECMAScript's exponentiate), so `1 ^ NAN` and `(-1) ^ INF` are NaN. C's and Rust's `pow` return 1 for both; the Rust runtime will have to special-case them to match.
- **`\`, `MOD` and `%` storage never produce -0.** The Rust runtime will compute these in `i64`, which has no -0, and `(-0) ^ -1` would otherwise print `-INF` in one backend and `INF` in the other.
- **INPUT and READ store each target before evaluating the next target's subscripts,** so `INPUT I, A(I)` and `READ I, A(I)` use the new `I`, as classic BASIC did. Doc 01's "evaluate the targets' subscripts left to right and store left to right" allows either order.
- **DIM evaluates all of one array's bounds before checking any of them,** and checks them (?FC) before checking whether the array already exists (?DD). Phase 3 can then emit `dim("A", [b1, b2])` with JavaScript's own argument order.
- **The label INPUT passes to `requestInput` is the prompt's text, or `?` when there is none.** The `??` continuation keeps the same label.
- **STOP prints `BREAK IN n` followed by a line break,** like an error line.

## Golden changes

None yet.

## Deferred

Features that came up and were left out because Doc 01 doesn't list them.
