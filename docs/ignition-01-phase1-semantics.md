# Ignition — Doc 01: Phase 1 Semantics

**Version:** 0.1 (draft)
**Date:** 2026-10-24
**Author:** Christopher Schweda
**Status:** Proposed — every rule below is a default for review. Edit it before kickoff; after kickoff, changes go through `docs/DECISIONS.md`.

This document fixes the observable behaviour of Phase 1 ("Spark") programs: everything a golden transcript can see, and everything the JavaScript and Rust backends must later reproduce exactly. It refines Master Design §2 and wins over it wherever they differ.

> **The reversibility rule.** When this document makes something a compile error, a later phase can allow it without changing any existing program or golden. When it gives something a behaviour, that behaviour is frozen into goldens and, eventually, into three backends. So when a choice is unclear, Phase 1 forbids.

## Contents

1. Scope
2. Program structure
3. Lexical rules
4. Types and variables
5. Expressions
6. Number formatting
7. PRINT
8. INPUT
9. Control flow
10. Arrays
11. DATA, READ, RESTORE
12. Built-in functions
13. RND and the generator
14. TIMER and other host inputs
15. Errors
16. Execution model and APIs
17. The Index object
18. Transcripts and conformance
19. Deferred

---

## 1. Scope

Phase 1 implements Level 1 only. Every item in Master Design §2 is either in or out:

| Item (Master Design §) | Phase 1 | Notes |
|---|---|---|
| Line-numbered programs (§2.1) | In | §2 below |
| Case-insensitive keywords and identifiers, long names (§2.2) | In | |
| `$` and `%` sigils (§2.2) | In | |
| `#` and `!` sigils (§2.2) | In | Accepted and ignored: `A#`, `A!` and `A` are one variable |
| `REM`, `'`, `:` separator, `""` inside strings (§2.2) | In | |
| `&H` hex literals (§2.2) | In | |
| `_` line continuation (§2.2) | Out → Phase 2 | A Level 2 convenience |
| `LET` (optional) `PRINT` `INPUT` `IF…THEN…ELSE` `FOR`/`NEXT` `GOTO` `GOSUB`/`RETURN` `ON…GOTO/GOSUB` `DIM` `DATA` `READ` `RESTORE` `END` `STOP` `REM` `RANDOMIZE` `CLS`, and the `MID$` statement | In | |
| `LOCATE` (§2.5) | Out → Phase 5 | Needs a screen model. It means nothing in a scrolling log, or in Rust without the `tty` feature |
| The Phase 1 functions (§2.4), and `TAB` inside PRINT | In | §12 |
| `OPTION BASE`, `OPTION CLASSICPRINT` (§2.3, §2.4) | Out → Phase 2 | |
| `BAND` `BOR` `BXOR` `BNOT` (§2.7) | Out → Phase 2 | §2.7's grammar gives them no precedence; Phase 2 chooses infix or function form |
| Level 2 statements (§2.4) | Out → Phase 2 | Their keywords are reserved now (§3) |
| Graphics, keyboard, files, memory, sound (§2.5) | Out → Phase 5 | Keywords reserved now |
| GUI verbs (§2.8) | Out → Phase 6 | Keywords reserved now; the `idle`/`dispatch` hook is built (§16) |
| Dialect profile for the BASIC Museum (§6.4) | Out | Keep the formatter, the `RND` mapping and the keyword table each in one module so a profile can be added later |

## 2. Program structure

- A program is a sequence of text lines. CRLF and CR are normalized to LF. Blank lines are ignored.
- Every other line starts with a line number: decimal digits, value 0–65529. Leading zeros are ignored (`010` is line 10).
- Line numbers must strictly increase from top to bottom. A duplicate or out-of-order number is a compile error (`?SN`).
  *Why:* classic interpreters sorted lines silently. A program that runs in a different order from the one the editor shows is confusing, and source order = output order keeps the line map trivial.
- A line holds one or more statements separated by `:`. Empty statements (`::`, a trailing `:`) are allowed and do nothing.
- Any compile error prevents the program from running. Warnings never do.
  *Why:* classic BASIC raised `?SN` only when the bad line executed. Ignition is a compiler, and the Rust backend can't emit a half-parsed program.
- `END` is optional; running off the last line ends the program.

## 3. Lexical rules

**Reserved words.** All of these are reserved from Phase 1 on, including those whose statements arrive later, so that no Phase 1 program breaks when a later phase adds them. A reserved word can't be an identifier with or without a sigil: `LEFT`, `LEFT$` and `LEFT%` are all unavailable.

- Phase 1: `ABS AND ASC ATN CHR$ CLS COS DATA DIM ELSE END EXP FIX FOR GOSUB GOTO IF INPUT INSTR INT LCASE$ LEFT$ LEN LET LOG MAX MID$ MIN MOD NEXT NOT ON OR PRINT RANDOMIZE READ REM RESTORE RETURN RIGHT$ RND ROUND SGN SIN SPACE$ SQR STEP STOP STR$ STRING$ TAB TAN THEN TIMER TO TRIM$ UCASE$ VAL`
- Level 2: `BAND BASE BNOT BOR BXOR CALL CASE CLASSICPRINT CONST DO ELSEIF EXIT FUNCTION LOOP OPTION SELECT SUB UNTIL WEND WHILE`
- I/O: `APPEND AS BEEP CIRCLE CLOSE COLOR EOF INKEY$ KEY LINE LOCATE OPEN OUTPUT PAINT PEEK POKE PSET SCREEN SOUND`
- GUI: `ASKBOX BUTTON CHANGE CHECKBOX CHECKED CLICK ENABLE FOCUS GETTEXT$ HIDE LABEL LISTADD LISTBOX LISTCLEAR LISTITEM$ LISTSEL MSGBOX SETTEXT SHOW TEXTBOX WAIT WINDOW`
- Also: `ERROR`, kept free for a possible `ON ERROR` (Master Design §8.6).

**Identifiers.** An ASCII letter, then ASCII letters, digits or `_`, then an optional sigil (`$ % # !`). Any length, case-insensitive. Words are read longest-first, so `TOTAL`, `FORM` and `PRINTER` are identifiers. A keyword must therefore be followed by a character that can't continue a name: `FOR I = 1 TO 10` and `GOTO 100`, not `FORI=1TO10` or `GOTO100`. *Why:* long names make classic "crunched" code ambiguous.

**Numbers.** `123`, `1.5`, `.5`, `5.`, `1E10`, `2.5e-3`, and hex `&HFF` (case-insensitive, unsigned). A literal has no sign (unary minus is an operator) and no type suffix. A literal that isn't finite, or a hex literal above 2^53 − 1, is a compile error (`?OV`).

**Strings.** Double-quoted and on one line; `""` inside a string is a literal quote. No escapes. Any character except a line break. An unterminated string is `?SN`.

**Comments.** `'` starts a comment anywhere outside a string. `REM` starts one only where a statement can start (after the line number or a `:`), and only as a whole word, so `REMARK` is an identifier. Both run to the end of the line, swallowing any `ELSE` on it. The comment node keeps the raw text after `REM` or `'`.

**DATA** is read differently from other statements; see §11.

## 4. Types and variables

**Value types.** An expression is a *number* (IEEE-754 f64), a *string*, or a *boolean*. Integer (`%`) is a storage type, not an expression type: reading a `%` variable gives a number.

**Variables** are identified by name (case-insensitive), sigil type and whether they're arrays. `A`, `A%`, `A$`, `A()`, `A%()` and `A$()` are six different variables, as in classic BASIC; `A#` and `A!` are `A`.

| Sigil | Holds | Default |
|---|---|---|
| none, `#`, `!` | a number | `0` |
| `%` | a whole number from −(2^53 − 1) to 2^53 − 1 | `0` |
| `$` | a string | `""` |

Variables need no declaration and are all global. A variable's display name is its spelling at its first occurrence in the source.

**Storing into `%`.** The value is truncated toward zero. A value that isn't finite, or that falls outside the range, raises `?OV`. *Why `%` is not i64:* TypeScript has no i64 short of BigInt, and the interpreter is the reference. Rust may store `%` as `i64`, but it must apply the same range check.

**Booleans** come only from comparisons and from `AND`, `OR` and `NOT`. In Phase 1 a boolean can't be stored (there's no boolean sigil), printed, passed to a function or compared with anything. Each of those is a compile error (`?TM`). When a boolean is compared with a number, the message explains that comparisons are true or false, not `-1` or `0`. *Why:* this is reversible, and Master Design §8.2 is still open.

**Conditions must be boolean.** `IF X THEN` with a numeric `X` is `?TM` (write `IF X <> 0 THEN`). So are numeric operands of `AND`, `OR` and `NOT`. *Why:* reversible, and numeric truthiness is where `-1`-as-true comes from.

**No implicit conversion** between strings and numbers, anywhere: that includes READ (§11) and INPUT (§8).

## 5. Expressions

**Precedence**, loosest first (Master Design §2.7):

| Level | Operators | Associativity |
|---|---|---|
| 1 | `OR` | left |
| 2 | `AND` | left |
| 3 | `NOT` | prefix |
| 4 | `=` `<>` `<` `>` `<=` `>=` | none (`A < B < C` is `?SN`) |
| 5 | `+` `-` | left |
| 6 | `*` `/` `\` `MOD` | left |
| 7 | unary `-` and `+` | prefix |
| 8 | `^` | right; binds tighter than a unary minus on its left: `-2^2` is `-4`, `2^-1` is `0.5` |

`\` and `MOD` share a level with `*` and `/`, as in JS and Rust (in GW-BASIC they bind looser): `7 \ 2 * 3` is `9`.

**Evaluation order** is left to right everywhere: operands, function arguments, PRINT items, subscripts, and the three FOR expressions. `AND` and `OR` short-circuit: the right operand isn't evaluated when the left one decides the result. Both are observable in Phase 1. `IF I <= 10 AND A(I) > 0` must not raise `?BS` when `I` is 11, and an `RND` that isn't evaluated doesn't advance the generator. *Why:* it maps straight onto `&&` and `||` in both targets.

**Assignment** `target = expr`: evaluate the target's subscripts left to right, then `expr`, then bounds-check and store. *Why:* that's the classic and JavaScript order. Rust evaluates the right-hand side first, so its emitter must hoist a temporary when both sides have side effects.

**Operators:**

| Operator | Operands | Result |
|---|---|---|
| `+` | two numbers, or two strings | sum, or concatenation; mixed operands are `?TM` at compile time |
| `-` `*` | numbers | IEEE f64 |
| `/` | numbers | IEEE f64; a divisor of `0` (or `-0`) raises `?/0` |
| `^` | numbers | IEEE `pow` (`0 ^ 0` is 1) |
| `\` | numbers | both operands truncated toward zero first; the result is truncated toward zero (`-7 \ 2` is `-3`); a truncated divisor of 0 raises `?/0` |
| `MOD` | numbers | on truncated operands, with the sign of the dividend (`-7 MOD 2` is `-1`, `7 MOD -2` is `1`); a divisor of 0 raises `?/0` |
| comparisons | two numbers, or two strings | boolean; strings compare by code point, case-sensitive |
| `AND` `OR` `NOT` | booleans | boolean |

For `\` and `MOD`, a truncated operand that isn't finite or lies outside ±(2^53 − 1) raises `?OV`.

**Non-finite values.**
- `+ - * ^` follow IEEE and can produce infinities or NaN (from overflow, or from something like `(-8) ^ (1/3)`). PRINT shows these as `INF`, `-INF` and `NAN` (§6).
- Everything else checks:
  - division, `\` and `MOD` by zero raise `?/0`;
  - built-in functions check their arguments and results (§12);
  - stores into `%` and subscripts check their values (§4, §10).

*Why the operators don't check:* a check on every `+` and `*` would wrap nearly every arithmetic expression in the emitted JavaScript and Rust in a runtime call. Overflow past 1.8 × 10^308 is rare. Division by zero is common, which is why it stays an error (Master Design §2.3).

## 6. Number formatting

PRINT and `STR$` format numbers the same way. `@ignition/rt-js` and the Rust runtime each implement this algorithm themselves, because neither language's built-in formatting matches it.

1. NaN prints `NAN`; +∞ prints `INF`; −∞ prints `-INF`.
2. Zero, including `-0`, prints `0`.
3. A whole number with an absolute value below 10^16 prints its exact decimal digits, with a leading `-` if negative.
4. Anything else: round the absolute value to 15 significant digits, rounding the exact binary value half away from zero (which is what JavaScript's `toExponential(14)` does). Drop trailing zeros. Let E be the decimal exponent of the rounded value (value ≈ d.ddd… × 10^E).
   - If −7 ≤ E < 15, use fixed notation, with a `0` before the point when the value is below 1 (`0.5`, never `.5`).
   - Otherwise use scientific notation: an upper-case `E`, an explicit sign and at least two exponent digits (`1.5E-08`, `1E+21`).
5. Negative values get a leading `-`. Positive values get no padding of any kind (Master Design §2.3).

*Why 15 digits:* 15 is the largest number of digits that always survives a decimal → binary → decimal round trip. It hides float noise (`0.1 + 0.2` prints `0.3`). It also hides last-place differences between maths libraries: JavaScript leaves `Math.sin` and similar functions up to each engine, and Rust uses the platform's library, so full precision could print differently in Node, Safari and Rust.

Test vectors (generated from a reference implementation of these rules; any implementation must reproduce them exactly):

| Value | Prints |
|---|---|
| `0`, `-0` | `0` |
| `3`, `-3` | `3`, `-3` |
| `0.5` | `0.5` |
| `0.1 + 0.2` | `0.3` |
| `1/3` | `0.333333333333333` |
| `2/3` | `0.666666666666667` |
| `-2.5` | `-2.5` |
| `1234567.1234567` | `1234567.1234567` |
| `1.4142135623730951` (√2) | `1.4142135623731` |
| `1 + 2^-15` (an exact tie at the 15th digit) | `1.00003051757813` |
| `1E15` | `1000000000000000` |
| `2^53` | `9007199254740992` |
| `1E16` | `1E+16` |
| `12345678901234567890` | `1.23456789012346E+19` |
| `0.00001` | `0.00001` |
| `1E-7` | `0.0000001` |
| `1.5E-8` | `1.5E-08` |
| `1.7976931348623157E308` (largest double) | `1.79769313486232E+308` |
| `5E-324` (smallest double) | `4.94065645841247E-324` |
| `1E308 * 10` | `INF` |
| `-1E308 * 10` | `-INF` |
| `X - X` where `X = 1E308 * 10` | `NAN` |

## 7. PRINT

- The console keeps a **column counter**: the number of characters (code points) printed since the last line break. It starts at 0 and resets on a line break, on `CLS`, and after an embedded `CHR$(10)`.
- Items are separated by `;` (nothing in between) or `,` (move to the next zone). A separator is required between items: `PRINT "A" "B"` and `PRINT TAB(5)"X"` are `?SN`.
- **Zones** are 16 columns wide, as on TRS-80 Level II. A `,` prints spaces up to the next multiple of 16 that is greater than the current column; from column 16 it moves to 32.
- **`TAB(n)`** is valid only as a PRINT item. `n` is truncated; outside 0–255 it raises `?FC`. Columns count from 0. If the column is below `n`, print spaces up to column `n`; otherwise print nothing.
- A PRINT that ends with `;` or `,` leaves the cursor where it is. Any other PRINT ends with a line break; a bare `PRINT` prints just the line break.
- Strings print as they are; numbers print as in §6; booleans are a compile error (§4).
- There is no line width: Ignition never wraps output. The IDE may wrap long lines visually, but the column counter doesn't change.
- `CLS` clears the console and resets the column to 0.

## 8. INPUT

`INPUT ["prompt" (; | ,)] target [, target …]`. Each target is a variable or an array element.

1. **Prompt.**
   - With `;` after the prompt, print the prompt and then `? `.
   - With `,`, print the prompt only.
   - With no prompt, print `? `.

   The VM prints the prompt itself, so the column counter and the transcript include it.
2. **Read a line.** The VM enters `waiting-input`. When the host supplies the line, the VM prints it exactly as typed, followed by a line break. This echo makes transcripts read like a terminal session.
3. **Split into fields.**
   - One target that is a string takes the whole line, trimmed of leading and trailing spaces, without splitting on commas.
   - Otherwise, split the line at commas and trim spaces from each field. A field that starts with `"` runs to the next `"` and can contain commas. Anything other than spaces between the closing quote and the next comma makes the line invalid.
4. **Too few fields:** print `?? ` and read another line for the remaining targets (steps 2–3).
5. **Too many fields:** print `?EXTRA IGNORED` and a line break, then carry on with the fields that were needed.
6. **Invalid input** is any of these:
   - a numeric target whose field isn't a complete numeric literal (the grammar in §11);
   - a numeric value that isn't finite;
   - a value that doesn't fit a `%` target;
   - a quoted field for a numeric target.

   The VM prints `?REDO FROM START` and a line break, discards everything this INPUT has read, and starts again at step 1.
7. **Assign.** Once every target has a valid value, evaluate the targets' subscripts left to right and store left to right. That means a `?BS` can only happen after the input has been accepted.

Transcript of `INPUT "YOUR GUESS"; G` when the user types `abc`, then `50`:

```
YOUR GUESS? abc
?REDO FROM START
YOUR GUESS? 50
```

## 9. Control flow

**IF.** `IF cond THEN (n | statements) [ELSE (n | statements)]`, all on one line.
- `cond` must be a boolean.
- The THEN branch is every statement up to `ELSE`, or to the end of the line; the ELSE branch is everything after `ELSE`.
- After `THEN n` or `ELSE n`, only an `ELSE` or the end of the line may follow.
- Each `ELSE` belongs to the nearest IF on the line that doesn't have one yet.
- `IF … GOTO n` (without `THEN`) isn't supported.

**Jumps.** `GOTO`, `GOSUB`, `IF … THEN n`, `ON … GOTO/GOSUB` and `RESTORE n` all take literal line numbers. A missing line is a compile error (`?UL`). A jump lands on the first statement of its line.

**ON.** `ON expr GOTO l1, l2, …` (or `GOSUB`).
- `expr` is truncated.
- A value that isn't finite, or is negative, raises `?FC`.
- A value of 0, or one larger than the number of targets, continues with the next statement.
- Otherwise the VM jumps to that target. `ON … GOSUB` returns to the statement after the ON.

**GOSUB and RETURN.**
- GOSUB pushes a frame and jumps.
- RETURN pops the frame and continues with the statement after the GOSUB, which may be on the same line.
- RETURN without a GOSUB frame raises `?RG`.
- More than 1,000 active GOSUB frames raise `?OM`. *Why a limit:* recursion depth must match in every backend, and JS and Rust stack limits don't.

**FOR and NEXT.** The rules are static: the source text fixes the shape of every loop, whatever executes.
- **`FOR v = a TO b [STEP s]`.** `v` is a simple numeric variable (a number or `%`, never an array element). The VM evaluates `a`, `b` and `s` once, in that order; `s` defaults to 1. It then stores `a` into `v`, with `%` truncation.
- **The test comes before the body.** The loop runs while `v <= b` if `s >= 0`, or while `v >= b` if `s < 0`. If the test fails at the start, the body is skipped: `FOR I = 10 TO 1` runs zero times. `STEP 0` with `v <= b` loops forever.
- **`NEXT`** sets `v = v + s` (with `%` truncation) and tests again. After a normal exit, `v` holds the first value that failed the test: `FOR I = 1 TO 10` leaves `I` at 11, and `FOR I = 1 TO 9 STEP 3` leaves it at 10.
- **Pairing.**
  - Each NEXT closes the innermost open FOR above it in the same statement list.
  - A bare `NEXT` closes one loop; `NEXT J, I` closes two, innermost first.
  - A name that doesn't match the loop being closed raises `?NF`.
  - A FOR without a NEXT raises `?SN`.
  - "The same statement list" means the FOR and its NEXT are both top-level statements, or both inside the same IF branch. So `IF X THEN NEXT I` raises `?NF`.
- **Loop region.** A loop's region is the statements after the FOR, through its NEXT. A line belongs to the region if its first statement does.
  - A jump from outside a region to a line inside it is a compile error, for example `?SN` "GOTO 50 jumps into the FOR loop at line 40". Precisely: a jump from S to T is legal only if every loop whose region contains T also contains S.
  - Jumping *out* of a loop is fine, and ends that loop.
- **Loop records live in the current frame,** which is the main program or the current GOSUB activation.
  - FOR stores `{ b, s }` there, keyed by the FOR statement. RETURN discards its frame's records.
  - A NEXT whose FOR has no record in the current frame raises `?NF` at runtime, for example a subroutine that GOTOs a NEXT instead of RETURNing.
  - *Why:* this gives the same per-activation behaviour that extracted subroutines get as functions in Phase 3.

**END** stops the program. **STOP** prints `BREAK IN n` (starting a new line if the column isn't 0) and stops. Both end in the `ended` state, not `error`, as does running off the last line.

## 10. Arrays

- **DIM.** `DIM A(n1 [, n2 …])` creates an array with lower bound 0 and inclusive upper bounds `n1`, `n2`, ….
  - DIM is a runtime statement: the bounds are expressions, truncated when the DIM runs.
  - One statement can create several arrays: `DIM A(10), B$(3, 3)`.
  - A bound that isn't finite, or is negative, raises `?FC`.
  - More than 16,777,216 elements in total raises `?OM`.
  - DIM of an array that already exists, whether explicitly or implicitly, raises `?DD`.
- **Implicit DIM.** Using an array that hasn't been dimensioned yet creates it with an upper bound of 10 in each dimension. If a DIM for it runs later, that DIM raises `?DD`. The Index warns (`IMPLICIT_DIM`) about any array that has no DIM statement anywhere in the program.
- **Dimension count.** An array has one dimension count for the whole program. Using it with a different number of subscripts anywhere, including in its DIM, is a compile error (`?BS`).
- **Subscripts** are truncated. A subscript that isn't finite, is below 0 or is above its bound raises `?BS`.
- **Elements** start at `0` or `""`. Elements of `%` arrays follow the `%` storage rule.

## 11. DATA, READ, RESTORE

**DATA.**
- A DATA statement holds a comma-separated list of items. It runs to the next `:` or `'` outside quotes, or to the end of the line.
- DATA must be a top-level statement, not inside an IF branch. It never executes; it only declares items.
- Each item, trimmed of spaces, is one of these:
  - a numeric literal, optionally signed → a number (a value that isn't finite is a compile error, `?OV`);
  - a quoted string (`""` is a literal quote) → a string;
  - anything else → an unquoted string, which can't contain `"` (`?SN`);
  - nothing at all (the middle item of `DATA 1,,3`) → the empty string.

**The numeric grammar,** shared by DATA, INPUT and `VAL`:
- an optional `+` or `-`;
- then either a decimal number (`123`, `1.5`, `.5`, `5.`, with an optional exponent: `E` or `e`, an optional sign, digits) or `&H` followed by hex digits.

**The DATA pool** is every item of every DATA statement, in program order.
- READ takes the next item. A number goes into a numeric target (with the `%` rule) and a string into a string target.
- A type mismatch raises `?TM` at runtime; READ never converts.
- Reading past the last item raises `?OD`.

**RESTORE.**
- `RESTORE` moves the pointer back to the first item.
- `RESTORE n` moves it to the first item on line `n` or later. Line `n` must exist (`?UL` at compile time).
- If there's no DATA at or after `n`, the next READ raises `?OD`.

## 12. Built-in functions

**Checks that apply to every built-in except `STR$`** (which formats any number, §6):
- A numeric argument that is NaN or infinite raises `?FC`.
- A result that would be infinite raises `?OV`.
- The domain errors in the table below raise `?FC`.
- "Truncated" always means toward zero.

| Function | Result | Errors |
|---|---|---|
| `ABS(x)` | absolute value | |
| `SGN(x)` | −1, 0 or 1 (`SGN(-0)` is 0) | |
| `INT(x)` | floor | |
| `FIX(x)` | truncated | |
| `SQR(x)` | square root | x < 0 → `?FC` |
| `SIN(x)` `COS(x)` `TAN(x)` `ATN(x)` | in radians | |
| `EXP(x)` | e to the power x | overflow → `?OV` |
| `LOG(x)` | natural logarithm | x ≤ 0 → `?FC` |
| `ROUND(x [, n])` | x rounded to `n` decimal places (default 0; a negative `n` rounds to tens, hundreds…). Rounds the decimal value PRINT shows for x (§6), ties away from zero | `n` truncated; outside −15…15 → `?FC` |
| `MIN(a, b, …)` `MAX(a, b, …)` | smallest / largest of two or more numbers | |
| `RND(x)` | see §13 | |
| `LEN(s)` | number of code points | |
| `LEFT$(s, n)` `RIGHT$(s, n)` | the first / last `n` code points (all of `s` if `n` ≥ `LEN(s)`) | `n` truncated; `n` < 0 → `?FC` |
| `MID$(s, start [, len])` | `len` code points from position `start` (1-based); without `len`, the rest of `s` | `start` < 1 or `len` < 0 → `?FC`; `start` > `LEN(s)` gives `""` |
| `INSTR([start,] hay, needle)` | 1-based position of `needle` at or after `start` (default 1), or 0 if absent | `start` < 1 → `?FC`; an empty `needle` gives `start` if `start` ≤ `LEN(hay)`, else 0 |
| `STR$(x)` | x formatted as in §6 | |
| `VAL(s)` | the longest prefix of `s`, after leading spaces, that matches the numeric grammar (§11); 0 if none. A space ends the number: `VAL("1 2")` is 1 | infinite result → `?OV` |
| `CHR$(n)` | the one-character string for code point `n` | `n` truncated; outside 0…1114111, or a surrogate (55296…57343) → `?FC` |
| `ASC(s)` | code point of the first character | `s` = `""` → `?FC` |
| `UCASE$(s)` `LCASE$(s)` | Unicode default case mapping, independent of locale (`UCASE$("ß")` is `"SS"`) | |
| `TRIM$(s)` | `s` without leading and trailing spaces (U+0020 only) | |
| `STRING$(n, c)` | `n` copies of `c`'s first character; `c` is a string or a code point | `n` < 0, `c` = `""`, or a bad code point → `?FC` |
| `SPACE$(n)` | `n` spaces | `n` < 0 → `?FC` |
| `TIMER` | see §14 | |
| `TAB(n)` | inside PRINT only (§7) | |

**The `MID$` statement.** `MID$(v$, start [, len]) = e$` overwrites characters of the string variable or element `v$` in place, starting at `start`. It overwrites the smallest of `len`, `LEN(e$)` and `LEN(v$) − start + 1` characters, so `v$` never changes length. `start` < 1, `start` > `LEN(v$)` or `len` < 0 raises `?FC`.

*Why exact definitions:* the native versions disagree. JavaScript's `Math.round(-2.5)` is −2 but Rust's `round()` gives −3. JavaScript's `trim()` strips U+FEFF and Rust's doesn't. `"😀".length` is 2 in JavaScript, while Rust's `chars().count()` is 1.

`ROUND` test vectors:

| Call | Result | Note |
|---|---|---|
| `ROUND(2.5)` | `3` | |
| `ROUND(-2.5)` | `-3` | JavaScript's `Math.round` gives −2 |
| `ROUND(-0.5)` | `-1` | |
| `ROUND(1.005, 2)` | `1.01` | 1.005 is stored as 1.00499999…, but PRINT shows `1.005` |
| `ROUND(2.675, 2)` | `2.68` | |
| `ROUND(1/3, 4)` | `0.3333` | |
| `ROUND(1234.5678, -2)` | `1200` | |
| `ROUND(0.49999999999999994)` | `1` | PRINT shows `0.5` |

## 13. RND and the generator

**The generator** is xorshift128+ with shifts 23, 18 and 5 (Vigna's final parameters), seeded through SplitMix64. All arithmetic is on unsigned 64-bit integers and wraps.

```
splitmix64(x):                 // x is 64-bit state, updated in place
  x = x + 0x9E3779B97F4A7C15
  z = x
  z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9
  z = (z ^ (z >> 27)) * 0x94D049BB133111EB
  return z ^ (z >> 31)

seed(k):                       // k is an integer with |k| <= 2^53 - 1
  x = k, as a two's-complement u64
  s0 = splitmix64(x)
  s1 = splitmix64(x)

next():                        // a float in [0, 1)
  t = s0
  u = s1
  result = u + t
  s0 = u
  t = t ^ (t << 23)
  s1 = t ^ u ^ (t >> 18) ^ (u >> 5)
  return (result >> 11) * 2^-53
```

**Seeding.**
- At program start the generator is seeded with `k = 0`.
- `RANDOMIZE n` seeds with `k = FIX(n)`. If `n` isn't finite, or `|k|` > 2^53 − 1, it raises `?FC`.
- A bare `RANDOMIZE` seeds with `FIX(entropy())`, where the host supplies `entropy()` (§14).
- Seeding forgets the last value.

**`RND(x)`:**

| `x` | Result |
|---|---|
| negative, or not finite | `?FC` |
| 0 | the last value drawn since seeding; if there is none, behaves like `RND(1)` |
| above 0, up to 1 | `next()`: a float in [0, 1) |
| above 1 | `m = FIX(x)` (above 2^53 − 1 → `?FC`); `u = next()`; the result is `MIN(m, 1 + FIX(u * m))`, a whole number from 1 to `m` |

Every case except `x = 0` draws exactly one value, and that float `u` becomes the last value, even when RND returns a whole number.

*Naming:* this is Ignition's own convention. `RND(1)` and `RND(0)` follow Microsoft BASIC (GW-BASIC, Applesoft), and `RND(n)` for `n` > 1 follows TRS-80 Level II. On a real Level II, `RND(0)` returned the float and `RND(1)` always returned 1.

**Test vectors** (generated from a reference implementation; any implementation must reproduce them exactly):
- After `seed(0)`: `s0 = 0xE220A8397B1DCDAF` (the published first output of SplitMix64 from 0) and `s1 = 0x6E789E6AA1B965F4`.
- The first five `RND(1)` of an unseeded program:

  | # | `result >> 11` | PRINT shows |
  |---|---|---|
  | 1 | 2835815852120806 | `0.314838805262153` |
  | 2 | 72414381107965 | `0.00803961132200437` |
  | 3 | 3367929637533554 | `0.373915302890721` |
  | 4 | 4134135027186406 | `0.45898118940917` |
  | 5 | 2233321285806917 | `0.24794847128883` |

- `RANDOMIZE 42`, then ten `RND(6)`: `6 5 5 6 6 1 3 6 5 1`
- `RANDOMIZE -1`, then three `RND(1)`: `0.806540123877638`, `0.6060760004281`, `0.125025527383241`
- `RANDOMIZE 7`, then `RND(100)`: `41`. That's the secret number in Master Design §4's worked example.

## 14. TIMER and other host inputs

- `TIMER` (no parentheses) is the number of seconds since the program started, read from a clock the host supplies (`clock` in §16).
- The IDE uses a real monotonic clock.
- The conformance tool uses a virtual clock that advances 0.001 s each time `TIMER` is read. It's deterministic, and a busy-wait like `IF TIMER < 1 THEN 10` still finishes.
- `entropy()` returns a whole number in [0, 2^53). The IDE uses `crypto.getRandomValues`; the conformance tool always returns 0.

## 15. Errors

**Codes.** These are the classic two-letter codes (Master Design §2.6), plus the ones Phase 1 needs:

| Code | Meaning | At compile time | At runtime |
|---|---|---|---|
| `SN` | Syntax error | malformed code; line order; FOR without NEXT; jump into a loop | — |
| `TM` | Type mismatch | mixed types; non-boolean condition; a boolean used as a value | READ into the wrong type |
| `UL` | Undefined line | jump or `RESTORE` to a missing line | — |
| `NF` | NEXT without FOR | an unmatched or misnamed NEXT | a NEXT with no loop record in the current frame |
| `RG` | RETURN without GOSUB | — | RETURN with no GOSUB frame |
| `OD` | Out of DATA | — | READ past the last item |
| `BS` | Subscript out of range | wrong number of subscripts | a bad subscript |
| `DD` | Redimensioned array | — | DIM of an array that exists |
| `/0` | Division by zero | — | `/`, `\` or `MOD` by zero |
| `FC` | Illegal function call | — | a bad argument (§12, §13); `ON` with a negative value |
| `OV` | Overflow | a literal out of range | a `%` value out of range; an infinite built-in result; a `\` or `MOD` operand out of range |
| `OM` | Out of memory | — | more than 1,000 GOSUBs deep; an array that is too large |

`OS` stays reserved and is never raised (Master Design §2.6).

**Display.** A runtime error prints `?XX ERROR IN n` (starting a new line if the column isn't 0) followed by a line break. The program then stops in the `error` state. The console line stays classic and terse; the IDE's Errors tab shows the long message.

**The error object,** shared by compile-time and runtime errors:

```ts
interface IgnitionError {
  code: 'SN' | 'TM' | 'UL' | 'NF' | 'RG' | 'OD' | 'BS' | 'DD' | '/0' | 'FC' | 'OV' | 'OM'
  message: string                            // "Subscript out of range: A(11), upper bound 10"
  lineno: number | null                      // Ignition line number, when known
  pos: { line: number; col: number } | null  // 1-based position in the source text
  phase: 'compile' | 'runtime'
}
```

Naming convention, used everywhere: `lineno` is an Ignition line number; `{ line, col }` is a 1-based position in the source text.

## 16. Execution model and APIs

**The requirement.** The VM can pause between any two statements, at any depth, without relying on the host's call stack. Phase 1 needs that for INPUT, Step and the run budget. Phase 2 needs it inside SUB and FUNCTION calls, including calls made from inside an expression. It's a Phase 1 decision because retrofitting it would mean rewriting the reference interpreter.

**The lowered IR.**
- The program lowers to a flat list of instructions with explicit jump targets.
- Each source statement becomes one instruction, and each such instruction is one step.
- Helper instructions (IF branch jumps, FOR exits) and comments are kept but are not steps; comments become no-ops attached to their source position.
- Every instruction carries `lineno` and `{ line, col }`.
- Phase 3's CFG builder reads this same list.

**VM state is plain data:** the program counter, the frame stack (the main program plus GOSUB frames, each with a return address and loop records), variables, arrays, the DATA pointer, generator state, the console column, any pending INPUT, and the status.
- Phase 1 expressions contain no user-defined calls, so evaluating them recursively is fine.
- Phase 2 must keep user calls off the host stack. It can either lower them into temporaries ahead of the statement (with `AND`/`OR` lowered to branches), or switch the evaluator to generators. Phase 2 makes that choice, but nothing in Phase 1 may depend on host recursion.

**API** (this refines the kickoff prompt's §4):

```ts
compile(source: string): { program: Program | null; index: Index; errors: IgnitionError[] }
// program is null when errors is non-empty

createVM(program, {
  console: ConsoleAdapter,
  clock?: () => number,    // seconds, for TIMER; default: a real monotonic clock
  entropy?: () => number,  // a whole number in [0, 2^53), for bare RANDOMIZE; default: crypto
})

type VMStatus = 'running' | 'waiting-input' | 'idle' | 'ended' | 'error'

vm.step(): VMStatus                      // runs exactly one statement
vm.run(budget = 10_000): VMStatus        // up to `budget` statements; stops early at INPUT, the end, or an error
vm.provideInput(text: string): VMStatus  // echo, parse, maybe re-prompt (§8)
vm.dispatch(event: { kind: string; id: string; data?: unknown }): void
vm.registerHandler(kind: string, id: string, target: { gosub: number } | { sub: string }): void
vm.currentLine(): number | null          // lineno of the next statement, or of the one waiting or failing
vm.error(): IgnitionError | null
```

- A **statement** is one `:`-separated statement. An IF is one step (the condition and the choice of branch); each statement in the chosen branch is another step. Step highlights the statement's line.
- In `waiting-input` and `idle`, `step` and `run` do nothing and return the current status. After `ended` or `error` they keep returning that status.
- Calling `provideInput` in any other status is a host bug, and it throws.
- `idle` and `dispatch` are built as the kickoff prompt describes (Master Design §2.8). A dispatched handler runs in a new frame whose return address is a sentinel; the RETURN (later, also END SUB) that pops it puts the VM back in `idle`.

**ConsoleAdapter** (the kickoff prompt's §5, without `locate`):

```ts
interface ConsoleAdapter {
  print(text: string): void            // may contain "\n" from CHR$(10); render it as a line break
  newline(): void
  cls(): void
  requestInput(prompt: string): void   // the VM has already printed the prompt; this signals the wait
                                       // and supplies a label (e.g. the input field's accessible name)
}
```

The VM prints prompts, input echoes, INPUT messages and error lines itself. Adapters only display what they're given.

**The runtime package.** `@ignition/rt-js` exists from Phase 1. It has no dependencies, uses no platform APIs, and holds:
- the number formatter;
- the PRINT column and zone logic;
- the INPUT field parser;
- the generator;
- every built-in function;
- the error codes and messages.

The interpreter calls it. Phase 3's emitted JavaScript imports the same functions, which is what makes Live and JS runs identical "by construction" (Master Design §3.3).

## 17. The Index object

```ts
interface Index {
  tier: 'L1'                                  // 'L2' arrives in Phase 2
  lines: number[]                             // linenos, in order
  variables: {
    name: string                              // display spelling, with sigil
    canonical: string                         // upper case, with sigil ($ or %)
    type: 'number' | 'integer' | 'string'
    array: null | { dims: number; implicit: boolean }
    firstLine: number                         // lineno of the first occurrence
  }[]
  procedures: []                              // filled in Phase 2 (SUB/FUNCTION) and Phase 3 (extracted GOSUBs)
  lineMap: { lineno: number; line: number }[] // Ignition line → source text line; emitted ranges join in Phase 3
  warnings: { lineno: number; code: string; message: string }[]
}
```

The only Phase 1 warning is `IMPLICIT_DIM`. The "RETURN reachable without GOSUB" warning (Master Design §3.1) needs the CFG, so it arrives in Phase 3.

## 18. Transcripts and conformance

**Example layout.** Each example is `packages/examples/NN-name/program.bas` plus one or more cases:
- the default case: `transcript.txt`, plus `input.txt` if the program reads input;
- named cases: `<case>.transcript.txt` and `<case>.input.txt` (example 10 has one case per error).

**Input files** hold one line per input request, re-prompts (`??`, `?REDO FROM START`) included.

**A transcript** is the exact character stream sent to the console: output, prompts, echoed input, `?EXTRA IGNORED`, `?REDO FROM START`, `BREAK IN n` and `?XX ERROR IN n`. It's UTF-8 with `\n` line breaks.
- `CLS` appears as a line containing exactly `[CLS]`, started on a new line if the column isn't 0. Examples must not print that text themselves.
- If the stream doesn't end with a line break, the runner adds one; golden files end with exactly one `\n`.

**Runner rules.**
- A case fails if:
  - its transcript differs (the runner shows a unified diff);
  - it asks for input after `input.txt` runs out;
  - it leaves input lines unused;
  - it runs more than 10,000,000 statements.
- The runner uses the virtual clock and `entropy() = 0` (§14).

**Golden policy.** Transcripts are written from this document and the Master Design *before* the interpreter exists. A golden changes only for a reason in the spec, and the change is recorded in `docs/DECISIONS.md`. Goldens are never regenerated from interpreter output.

The ten Phase 1 examples are listed in the Implementation Plan, Phase 1.

## 19. Deferred

What Phase 1 forbids or leaves out, and where each item is expected to land. Anything forbidden is a compile error today, so allowing it later breaks nothing.

| Item | Phase 1 | Later |
|---|---|---|
| `OPTION BASE`, `OPTION CLASSICPRINT`, `_` continuation | `?SN` | Phase 2 |
| `BAND` `BOR` `BXOR` `BNOT` | reserved | Phase 2: choose infix (needs a precedence level) or function form |
| `LOCATE` | reserved | Phase 5, with a screen model |
| Printing or storing booleans | `?TM` | Master Design §8.2 |
| `IF X THEN` with a numeric `X` | `?TM` | could later mean `X <> 0` |
| `RND` with a negative argument | `?FC` | could reseed, as classic BASIC did |
| `IF … GOTO n` without `THEN`; PRINT items without separators | `?SN` | could be allowed |
| NEXT inside an IF branch; jumping into a loop; computed GOTO | `?NF` / `?SN` | probably never: they defeat structured output |
| Crunched keywords (`FORI=1TO10`) | `?SN` | never; long names make it ambiguous |
| Dialect profile | not built | when the BASIC Museum needs it |
| "RETURN reachable without GOSUB" warning | — | Phase 3, once the CFG exists |
