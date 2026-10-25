# Ignition — Doc 00: Master Design

**Version:** 0.1 (draft)
**Date:** 2026-10-24
**Author:** Christopher Schweda
**Status:** Pre-Phase 1 — for review before any code is written

---

## 0. One-sentence thesis

Ignition is a small, 1978-flavored BASIC with a browser IDE that runs your program live and, from the same source, emits **readable, idiomatic JavaScript and Rust** you would actually commit.

The readability of the output is the product. Everything else in this document exists to serve it.

---

## 1. Why this and not another BASIC

The modern BASIC field splits into three groups, none of which occupies this spot:

| Group | Examples | What they do | What they don't do |
|---|---|---|---|
| Compatibility compilers | QB64, FreeBASIC | Native binaries, QBasic-shaped dialect | Output is unreadable machine C/C++; no browser; no second target |
| Commercial app builders | Xojo, B4X, PureBasic | Cross-platform GUI apps | Closed, large dialects, not a teaching bridge |
| Browser retro runtimes | wwwBASIC, Applesoft/C64 web emulators | Nostalgia in a `<canvas>` | Interpret only; nothing leaves the browser |

Ignition's position: **a teaching and prototyping bridge**. Write the way Gates' TRS-80 Level II BASIC taught you to write; see what that program *is* in a modern structured language, line for line, in two different language families (dynamic/GC and static/ownership). The IDE is built so that clicking a BASIC line highlights the JS and Rust it became.

### 1.1 Non-goals

- Not a QBasic/GW-BASIC compatibility target. Existing programs will not run unmodified. (That is the BASIC Museum's job.)
- Not a general-purpose application language. No classes, no modules, no generics, no async.
- Not a competitor to TypeScript. If a feature makes Ignition "a worse TypeScript with PRINT," it is rejected.
- Not cycle-accurate or ROM-accurate. No emulated CPU; no float40.

### 1.2 Design principles

1. **Small language, big toolchain.** Steroids go in the compiler, the runtimes, and the IDE — not the grammar.
2. **Every construct has a defined meaning in all three backends** (interpreter, JS, Rust). If something can't be given a definite meaning in Rust, it is not in the language.
3. **Readable output over fast output.** The emitters optimize for a human reader first, a benchmark second.
4. **Honest ugliness.** When spaghetti source produces awkward output, the IDE shows why instead of hiding it. That is the teaching moment.
5. **One numeric model.** f64 everywhere, by default. No surprises between backends.

---

## 2. The Ignition dialect

Doc 01 (`ignition-01-phase1-semantics.md`) pins down the exact Phase 1 behaviour — number formatting, evaluation order, INPUT, FOR/NEXT, errors, the random-number generator — and wins over this section wherever they differ.

### 2.1 Two tiers

Ignition defines two tiers of the same language. A program is in whichever tier its contents require; there is no mode switch.

| | **Level 1 — "Classic"** | **Level 2 — "Structured"** |
|---|---|---|
| Line numbers | Required on every line | Optional (labels allowed) |
| Control flow | `GOTO`, `GOSUB`/`RETURN`, `FOR`/`NEXT`, `IF…THEN` (single line), `ON…GOTO/GOSUB` | Adds `WHILE`/`WEND`, `DO…LOOP [WHILE/UNTIL]`, block `IF…ELSEIF…ELSE…END IF`, `SELECT CASE`, `SUB`/`FUNCTION`, `EXIT` |
| Compile path | Interpreter directly; JS/Rust via CFG + relooper | Interpreter directly; JS/Rust via direct AST lowering |
| Output quality | Readable when the control flow is reducible; awkward otherwise, and the IDE says so | Readable by construction |
| Audience | Nostalgia, first-week learners, the Museum crossover | Anyone who wants to ship the output |

Level 1 is a strict subset of Level 2. A Level 1 program is a valid Level 2 program. Nothing in Level 2 is forbidden from a line-numbered program; you can mix freely. The tier label is informational (shown in the IDE Index), not a compiler flag.

### 2.2 Lexical rules

- Case-insensitive keywords and identifiers. The emitters normalize: `camelCase` for JS, `snake_case` for Rust. The canonical display case in the IDE is upper-case keywords, user-chosen case for identifiers.
- Identifiers: letter followed by letters, digits, underscore. Unlimited length (no two-character truncation). Type sigils are **optional** and only mean something when used:
  - `$` suffix → string
  - `%` suffix → integer (i64 in Rust; `Math.trunc`-guarded in JS)
  - no sigil → f64
  - `#` and `!` are accepted and ignored (both mean f64) for muscle-memory compatibility.
- Comments: `REM` or `'` to end of line. Comments survive compilation and are emitted in place in both targets. (This is part of readability: your `REM` becomes a `//`.)
- Statement separator: `:` as in classic BASIC.
- Line continuation: `_` at end of line (Level 2 convenience).
- Strings: double-quoted; `""` inside a string is a literal quote. Backslash escapes are **not** supported (keeps the 1978 flavor and avoids a JS/Rust escape mismatch).
- Numbers: decimal, optional fraction and exponent. `&H` hex prefix allowed (for the `PEEK`/`POKE` crowd).

### 2.3 Data types

| Ignition type | Interpreter | JS | Rust |
|---|---|---|---|
| number (default) | f64 | `number` | `f64` |
| integer (`%`) | integer-valued f64 within ±(2^53 − 1) | `number` with `Math.trunc` at assignment | `i64`, with the same range check |
| string (`$`) | Unicode string, indexed by code point | `string` | `String` |
| array of any of the above | typed vector | `Array` / `Float64Array` where provably numeric | `Vec<T>` (multi-dim: `Vec<T>` with stride helper from runtime) |

Decisions:

- **No fixed string length, no `CLEAR n`.** Strings grow.
- **Arrays** are declared with `DIM` and are zero-based by default (`OPTION BASE 1` is honored, applied at compile time). Undeclared arrays default to 11 elements (0–10) exactly like classic BASIC, and the IDE Index warns about implicit `DIM`.
- **Numeric formatting.** `PRINT 3` prints `3`, not ` 3 `. Classic leading-space/trailing-space behavior is available via `OPTION CLASSICPRINT` (one line at the top of the program; emitted into the runtime config of both targets). Other numbers print with up to 15 significant digits (Doc 01 §6).
- **Division by zero** is an error (not `Infinity`). The JS runtime checks; Rust runtime checks. Interpreter matches. All three backends raise the same error text.
- **Integer division** `\` and `MOD` work on the truncated values.
- **String/number coercion is never implicit.** `PRINT "A" + 1` is a compile error. Use `STR$()` / `VAL()`. This single rule removes most of the output ugliness you'd otherwise get in Rust.

### 2.4 Statements and functions

**Core (Level 1):**
`LET` (optional) · `PRINT` (with `;` and `,` zones, `TAB()`) · `INPUT` · `IF…THEN [ELSE]` (single-line) · `FOR…TO…STEP / NEXT` · `GOTO` · `GOSUB` / `RETURN` · `ON n GOTO/GOSUB` · `DIM` · `DATA` / `READ` / `RESTORE` · `END` · `STOP` · `REM`

**Structured (Level 2):**
`WHILE…WEND` · `DO…LOOP WHILE/UNTIL` · block `IF…ELSEIF…ELSE…END IF` · `SELECT CASE…CASE…CASE ELSE…END SELECT` · `SUB name(params)…END SUB` · `FUNCTION name(params)…END FUNCTION` (returns by assigning to `name`) · `EXIT FOR/DO/SUB/FUNCTION` · `CALL` (optional) · `CONST` · `OPTION BASE` / `OPTION CLASSICPRINT`

**Numeric functions:** `ABS SGN INT FIX SQR SIN COS TAN ATN EXP LOG RND(n) ROUND(x,n) MIN MAX`
**String functions:** `LEN LEFT$ RIGHT$ MID$ (as function and as statement) INSTR STR$ VAL CHR$ ASC UCASE$ LCASE$ TRIM$ STRING$ SPACE$`
**Misc:** `TIMER` (seconds since program start, f64) · `RANDOMIZE [seed]`

`RND` semantics: `RND(1)` → [0,1); `RND(0)` → repeat last; `RND(n>1)` → integer 1..n. This is Ignition's own convention: `RND(1)` and `RND(0)` follow Microsoft BASIC, and `RND(n>1)` follows TRS-80 Level II (where `RND(0)` was the float and `RND(1)` always returned 1). It was chosen because it's the most useful combination, and the Museum will document the divergence. Exact rules and test vectors are in Doc 01 §13. All three backends use the same seeded PRNG (xorshift128+) so a `RANDOMIZE 42` program produces identical output everywhere. Determinism across backends is a hard requirement — it is how the test suite works.

### 2.5 I/O surface — the "steroid" layer, kept tiny

Each I/O family maps to a named runtime module. The language sees one verb; each backend has one small implementation.

| Family | Statements | Interpreter / JS runtime | Rust runtime |
|---|---|---|---|
| Console | `PRINT`, `INPUT`, `CLS`, `LOCATE r,c` | A text panel (DOM) with a 64×16 or 80×25 grid option | stdout/stdin; `LOCATE` via ANSI escapes (crate feature `tty`) |
| Graphics | `SCREEN w,h`, `PSET x,y[,c]`, `LINE x1,y1,x2,y2[,c]`, `CIRCLE x,y,r[,c]`, `COLOR fg[,bg]`, `PAINT` | `<canvas>` | A minimal framebuffer with PNG dump by default; optional `minifb` window behind a feature flag |
| Keyboard | `INKEY$`, `KEY(k)` | DOM key state | `crossterm` behind `tty` feature; always `""` otherwise |
| Files | `OPEN name$ FOR INPUT/OUTPUT/APPEND AS #n`, `PRINT #n`, `INPUT #n`, `LINE INPUT #n`, `EOF(n)`, `CLOSE #n` | In-browser virtual filesystem (IndexedDB) with import/export; `fetch` for `OPEN "https://…" FOR INPUT` | `std::fs`; HTTPS via `ureq` behind feature flag |
| Memory | `PEEK(a)`, `POKE a,v` | A 65,536-byte `Uint8Array` | `[u8; 65536]` in the runtime |
| Sound | `BEEP`, `SOUND f,d` | WebAudio | Terminal bell / no-op with warning |
| GUI (Phase 6) | `WINDOW`, `LABEL`, `TEXTBOX`, `BUTTON`, `LISTBOX`, `CHECKBOX`, `GETTEXT$`, `SETTEXT`, `ENABLE`, `SHOW`/`HIDE`, `MSGBOX`, `ON CLICK/CHANGE`, `WAIT` — see §2.8 | DOM widgets in a container; absolute positioning | **Not implemented.** A program using GUI verbs compiles for Rust only as a Tauri backend (see §2.8); a plain Rust build of a GUI program is a compile error, not a runtime surprise |

`PEEK`/`POKE` are **defined** as a plain 64 K byte array with no memory-mapped side effects. They are there so that the idiom exists and transpiles; they do not emulate anything. (The IDE Index flags their use as "retro only.")

Everything in this table is implemented in two runtime packages — `@ignition/rt-js` and the `ignition-rt` crate — and nothing else. Adding a verb means adding it to both. This discipline is what keeps the language from sprawling. The GUI family is the one deliberate exception (JS runtime only), and the Index labels any program that uses it "Web/desktop app."

### 2.6 Errors

Compile-time errors carry the source line number and column. Runtime errors carry the originating Ignition line in all three backends (the emitters keep a line map; the runtimes raise errors as an `IgnitionError` object / struct, whose shape is in Doc 01 §15). Classic error names are used where they exist: `?SN ERROR` → "Syntax error", `?RG ERROR` → "RETURN without GOSUB", `?OS ERROR` → "Out of string space" (never raised, but reserved for the Museum crossover), `?BS ERROR` → "Subscript out of range", `?/0 ERROR` → "Division by zero". The full Phase 1 table, which adds `?FC` (illegal function call), `?OV` (overflow), `?DD` (redimensioned array) and `?OM` (out of memory), is in Doc 01 §15. `ON ERROR GOTO` is **not** supported in v1; it would force exception machinery into the Rust output.

### 2.7 Grammar sketch

```
program     := line*
line        := [lineno] statement (':' statement)* EOL
statement   := let | print | input | if | for | next | goto | gosub | return
             | on | dim | data | read | restore | end | stop | rem
             | while | wend | do | loop | selectcase | sub | function | exit
             | call | const | option | io_statement
if          := 'IF' expr 'THEN' (lineno | statement+) ['ELSE' (lineno | statement+)]   -- single-line
             | 'IF' expr 'THEN' EOL block ('ELSEIF' expr 'THEN' EOL block)* ['ELSE' EOL block] 'END' 'IF'
expr        := orexpr
orexpr      := andexpr ('OR' andexpr)*
andexpr     := notexpr ('AND' notexpr)*
notexpr     := 'NOT' notexpr | relexpr
relexpr     := addexpr (('=' | '<>' | '<' | '>' | '<=' | '>=') addexpr)?
addexpr     := mulexpr (('+' | '-') mulexpr)*
mulexpr     := unary (('*' | '/' | '\' | 'MOD') unary)*
unary       := ('-' | '+') unary | power
power       := primary ('^' unary)?
primary     := number | string | ident ['(' args ')'] | '(' expr ')' | fncall
```

Operators `AND`/`OR`/`NOT` are **logical** (boolean), not bitwise, and comparisons yield a boolean — not `-1`/`0`. This is the single largest deliberate break from 1978 and it is made because `-1`-as-true produces absurd Rust. Bitwise ops are `BAND`, `BOR`, `BXOR`, `BNOT` on `%` values. (Comparing a boolean with a number is a compile-time type error whose message explains that comparisons are true or false, not `-1` or `0`.)

### 2.8 GUI verbs and the event model

Ignition programs can be useful desktop or browser apps, not only console programs. The GUI surface is deliberately tiny and absolutely positioned, in the spirit of Visual BASIC 1.0: enough for forms, lists and buttons; no layout engine, no styling language, no custom widgets.

**Verbs (all Level 2-friendly; GOSUB handlers allowed for Level 1 flavor):**

```
WINDOW title$, w, h                      ' creates the app window / container; at most one
LABEL id$, text$, x, y
TEXTBOX id$, x, y, w [, text$]
BUTTON id$, caption$, x, y [, w]
CHECKBOX id$, caption$, x, y [, checked]
LISTBOX id$, x, y, w, h
LISTADD id$, item$        LISTCLEAR id$        LISTSEL(id$)  -> index   LISTITEM$(id$, i)
GETTEXT$(id$)             SETTEXT id$, text$   CHECKED(id$) -> bool
ENABLE id$, bool          SHOW id$             HIDE id$      FOCUS id$
MSGBOX text$ [, title$]   r = ASKBOX(prompt$ [, default$])  ' modal, returns string
ON CLICK id$ GOSUB lineno | CALL SubName
ON CHANGE id$ GOSUB lineno | CALL SubName
WAIT                                      ' explicit: hand control to the event loop
```

Widget ids are strings so they can be computed (`"ROW" + STR$(I)`). Coordinates are in a fixed 8 px grid; `w`/`h` are in the same units. That's the whole model.

**Event model — the one semantic addition that must exist from Phase 1.**

Classic BASIC runs top to bottom and ends. An app runs top to bottom *and then waits*. Ignition defines:

1. The main program runs as usual. Setup code creates widgets and registers handlers.
2. When execution reaches `WAIT`, or falls off the end of the program while any `WINDOW` exists, the VM enters the **idle** state instead of ending. (`END` always ends, window or not.)
3. In idle, the host (IDE, browser, Tauri shell) delivers events. Each event runs its handler to completion — `RETURN` for a GOSUB handler, `END SUB` for a SUB — then the VM returns to idle. Handlers are never re-entered; events arriving during a handler are queued.
4. Handlers may do anything the main program can, including `INPUT` (the VM goes to `waiting-input` as usual), `PRINT` to the console panel, and graphics.
5. A program with no `WINDOW` is unaffected: falling off the end still means `ended`.

The VM step function therefore has one more state: `'running' | 'waiting-input' | 'idle' | 'ended' | 'error'`, plus `vm.dispatch(event)`. Phase 1 implements the state and `dispatch` with no GUI verbs behind them (a one-afternoon stub); Phase 6 adds the verbs. Building the hook early is what keeps Phase 6 from touching the interpreter core.

**Compilation.** In JavaScript, handlers become ordinary functions registered through `ui.on("id", "click", fn)`; the main program's trailing `WAIT` becomes nothing (the page simply stays alive). Because GUI programs are naturally Level 2, output is clean. In Rust, GUI programs compile only as a **Tauri backend**: each `SUB`/`FUNCTION` not referenced by a handler becomes a `#[tauri::command]`, the JS output drives the window, and the runtime bridges `GETTEXT$`-style calls over Tauri's invoke channel. A plain `cargo` target refuses GUI programs at compile time with a clear message.

---

## 3. Compiler pipeline

```
source text
   │
   ▼
Lexer ──► Parser ──► AST ──► Semantic pass ──► Lowering ──┬──► Interpreter
                                  │                       │
                                  │                       ├──► CFG ──► Relooper ──► Structured IR ──┬──► JS emitter
                                  │                       │                                        └──► Rust emitter
                                  │                       │
                                  └── Index data ◄────────┘   (line map, variables, tier, warnings)
```

### 3.1 Stages

1. **Lexer.** Hand-written, produces tokens with line/col. Handles `REM`/`'` as a token so comments survive.
2. **Parser.** Recursive descent over the grammar above. Produces an AST where every node carries its Ignition line number. Line numbers themselves are AST metadata, not control-flow nodes.
3. **Semantic pass.** Symbol table (variables typed by their sigil; `SUB`/`FUNCTION` signatures; `DATA` pool; labels and line numbers). Diagnoses: implicit `DIM` (a warning), mixed-type expressions, `NEXT` without `FOR`, duplicate or out-of-order line numbers, jumps to a nonexistent line or into a loop body, and — once the CFG exists in Phase 3 — `RETURN` reachable without a `GOSUB` (a warning). Produces the **Index** consumed by the IDE.
4. **Lowering.** Produces a flat instruction list with explicit jumps — Level 1 jumps as `Goto`/`Gosub` edges, Level 2 constructs desugared — which the interpreter runs and the CFG is built from (Level 2 emission works from the AST directly; see §2.1). Expressions get explicit coercions inserted here (e.g. `%` truncation).
5. **Interpreter.** Executes the lowered instruction list directly, holding all control state (program counter, GOSUB frames, FOR loop records) as data rather than on the host call stack, so it can pause between any two statements (Doc 01 §16). It is the reference semantics: if JS and Rust disagree with the interpreter, the interpreter is right. Runs in a Web Worker so the IDE never locks up on an infinite loop; supports step/pause/breakpoint on line.
6. **CFG.** Basic blocks from the lowered IR. Every `GOTO`, `GOSUB`, `ON…GOTO`, `IF…THEN lineno`, and loop boundary becomes an edge.
7. **Relooper.** Recovers structured control flow (`Loop`, `If`, `Block`/`break`, `Multiple`) from the CFG using the Emscripten Relooper algorithm (Zakai 2011), informed by the Stackifier approach from LLVM's WebAssembly backend (the choice of structuring algorithm is still open; see §8). Two special passes run first:
   - **GOSUB extraction.** A block set that is entered only via `GOSUB` from one or more sites, dominated by a single entry, and whose every exit is `RETURN`, becomes a procedure (`function sub_1200()` / `fn sub_1200()`). Named by its entry line number unless a `REM` immediately precedes it, in which case the REM text is used to derive the name (`REM --- draw board ---` → `drawBoard` / `draw_board`). This one heuristic is responsible for most of the readability win on Level 1 code.
   - **Loop idiom recovery.** `100 … 150 IF x<10 THEN 100` → `while`; `FOR`/`NEXT` always survives as a counted loop even when the body contains a forward `GOTO` out of it (`break`).
   When the relooper has to fall back to a `Multiple` (a `switch` on a label variable), the output is still correct but the IDE Index marks the offending region: *"Lines 300–420 are irreducible; consider a WHILE."* This is Principle 4.
8. **Emitters.** Walk the structured IR and print code. Both emitters:
   - keep comments in place,
   - keep a line map (`// L120` end-of-line markers, toggleable, used by the IDE to cross-highlight),
   - give user variables their user names, with case normalized,
   - declare each variable at its first assignment when that assignment comes before every use on every path, inside the innermost loop or block where it is live, and mutable only if it is reassigned (`const n = rnd(100);` / `let n = rnd(100.0);`); otherwise hoist it to the top of the enclosing function with its BASIC default (`let x = 0; let name = "";` / `let mut x: f64 = 0.0; let mut name = String::new();`). Hoisting everything would make rustc warn "value assigned is never read" and fail the Phase 4 clippy gate,
   - emit only the runtime imports actually used.

### 3.2 Readability rules the emitters obey

- Never emit a label variable if the relooper found a structured form.
- `FOR I = 1 TO 10` → `for (let i = 1; i <= 10; i++)` when `STEP` is 1, `I` is not assigned in the body, the limit can't change during the loop (JS re-evaluates `i <= n` on every pass), and `I` is not read after the loop (JS `let i` is scoped to the loop). In Rust, `for i in 1..=10` iterates integers, so it applies only when `I` is a `%` variable or every use of `i` accepts an integer. Otherwise both targets get a `while` with the BASIC loop semantics, including "after a normal exit the loop variable holds the first value that failed the test" (Doc 01 §9).
- `X = X + e` → `x += e` (clippy's `assign_op_pattern` requires it in Rust, and it reads better in JS too).
- `PRINT a; b, c$` → `print(a, b, "\t", c)` through the runtime, so the zone semantics are not inlined as string-padding noise.
- Strings concatenate with `+` in JS and `format!` or `push_str` in Rust depending on context; the Rust emitter prefers `format!("{}{}", a, b)` for ≥3 operands.
- `INPUT "Name? "; N$` → `const n = await io.input("Name? ")` (JS output is top-level `async`), `let n = io::input("Name? ")?;` in Rust (main returns `Result<(), IgnitionError>`).
- Rust emitter chooses `f64` arithmetic throughout, `as i64` only at `%` boundaries and array indices (`[i as usize]` with a runtime bounds check that yields `?BS ERROR` semantics instead of a panic).
- Integer-valued f64 literals print as `10.0` in Rust, `10` in JS.

### 3.3 Runtimes

- **`@ignition/rt-js`** — ES module, ~2 KB core, optional console/canvas/vfs adapters. The IDE uses the same runtime as the emitted code (so "Run" and "Run JS" produce identical behavior by construction): from Phase 1 the interpreter itself calls it for number formatting, PRINT and INPUT logic, `RND` and every built-in function.
- **`ignition-rt`** (crate) — `no_std`-free but minimal; features: `tty`, `graphics-png`, `graphics-window`, `net`. The emitted Cargo project pins the crate version that matches the compiler version.

A third runtime target is planned but not committed: **WASM via the Rust output**, so the IDE could run the Rust version in the browser next to the JS version. (See §6.3.)

---

## 4. Worked example

**Source (Level 1, deliberately old-school):**

```basic
10 REM GUESS THE NUMBER
20 RANDOMIZE 7
30 N = RND(100)
40 T = 0
50 REM --- ASK ---
60 INPUT "YOUR GUESS"; G
70 T = T + 1
80 IF G = N THEN 200
90 IF G < N THEN PRINT "TOO LOW" ELSE PRINT "TOO HIGH"
100 GOTO 60
200 PRINT "GOT IT IN "; T; " TRIES"
210 END
```

**Emitted JavaScript:**

```js
import { io, rnd, randomize } from "@ignition/rt-js";

// GUESS THE NUMBER
async function main() {
  randomize(7);
  const n = rnd(100);
  let t = 0;
  // --- ASK ---
  while (true) {
    const g = await io.input("YOUR GUESS");
    t += 1;
    if (g === n) break;
    if (g < n) io.print("TOO LOW"); else io.print("TOO HIGH");
  }
  io.print("GOT IT IN ", t, " TRIES");
}

main();
```

**Emitted Rust:**

```rust
use ignition_rt::{io, rnd, randomize, IgnitionError};

// GUESS THE NUMBER
fn main() -> Result<(), IgnitionError> {
    randomize(7.0);
    let n = rnd(100.0);
    let mut t = 0.0;
    // --- ASK ---
    loop {
        let g = io::input("YOUR GUESS")?;
        t += 1.0;
        if g == n { break; }
        if g < n { io::print(&["TOO LOW"]); } else { io::print(&["TOO HIGH"]); }
    }
    io::print(&[&"GOT IT IN ".into(), &t.into(), &" TRIES".into()]);
    Ok(())
}
```

Notes on what the pipeline did: lines 60–100 formed a single-entry loop with one exit edge (line 80 → 200), so the relooper produced `loop`/`break` rather than a label switch. The `REM --- ASK ---` is preserved in place. `N` is assigned once, so it becomes `const` / an immutable `let`; `T`'s first assignment comes before every use, so it is declared there; `G` is only live inside the loop, so it is declared inside it. No `GOSUB` existed, so no procedure extraction. (With Doc 01's generator, `RANDOMIZE 7` makes `N` 41.) The IDE Index for this program reads: *Tier: Level 1 · Variables: N, T, G (number) · Control flow: 1 loop, reducible · Warnings: none.*

The exact shape of the `io::print` call in Rust is an open decision (§8); the version above is a placeholder for whatever is cleanest once the runtime API settles.

---

## 5. The IDE

### 5.1 Layout (Inform 7 model)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Ignition   [▶ Run] [■ Stop] [⏭ Step]   Target: (Live)(JS)(Rust)    │
│  File ▾  Examples ▾  Export ▾  Settings ▾                 ◐ theme   │
├────────────────────────────┬────────────────────────────────────────┤
│                            │ [Run] [JavaScript] [Rust] [Index] [Errors] │
│   SOURCE                   │                                        │
│   (CodeMirror 6,           │   RIGHT PANE — contents depend on tab  │
│    Ignition grammar,       │                                        │
│    line-number gutter,     │   Run: console panel + canvas          │
│    auto-renumber tool,     │   JavaScript / Rust: read-only code    │
│    breakpoints)            │     view with cross-highlight          │
│                            │   Index: variables, subs, line map,    │
│                            │     tier, warnings, relooper report    │
│                            │   Errors: compile + runtime            │
├────────────────────────────┴────────────────────────────────────────┤
│  status: Level 1 · 12 lines · compiled 4 ms · no errors             │
└─────────────────────────────────────────────────────────────────────┘
```

- **Two panes, resizable, swappable** (Inform lets you flip sides; so does this).
- **Top bar**: Run/Stop/Step, and the **target chips**. The chips change what "Run" means: *Live* runs the interpreter; *JS* runs the emitted JavaScript in a sandboxed iframe with the same runtime; *Rust* runs the WASM build when available (§6.3) or shows "export to run".
- **Cross-highlighting**: click or cursor-move on a source line → the corresponding emitted lines glow in the JS and Rust tabs; hover an emitted line → the source line glows. This is driven by the line map and is the signature interaction of the product.
- **Index tab** is the Inform "Index" idea applied to a BASIC program: variable table with inferred types and first-use lines; procedures (SUB/FUNCTION and extracted GOSUB targets); the relooper report (reducible/irreducible regions, with a one-line suggestion each); tier; implicit DIMs; retro-only features used.
- **Errors tab**: compile errors as a list, click to jump; runtime errors show the Ignition line and, if the target is JS/Rust, the emitted line too.
- **Examples menu**: a curated set (the same "guess the number", a `GOSUB`-heavy one to show extraction, a `SELECT CASE` one, a canvas one, a file one). Each example exists to demonstrate one emitter behavior.
- **Export menu**: `.bas` source · `.js` single file · `.zip` Cargo project · "Copy JS" / "Copy Rust" · (Phase 6) **App exports**: single-file `.html`, Node CLI, **Tauri project**, Electron project.
- **Persistence**: programs are saved to `localStorage` keyed by a slug, with export/import JSON. No accounts, no backend (Netlify static). Shareable URLs encode the source in the fragment (LZ-compressed) so a program can be linked.

### 5.2 Editor details

- CodeMirror 6 with a hand-written Ignition language mode (Lezer grammar generated from §2.7).
- Auto-renumber (`RENUM`) tool with step and start; rewrites every jump target. Classic, and genuinely useful.
- Keyword auto-uppercase on line commit (toggle).
- Breakpoints by line (gutter click); Step runs one statement in the interpreter, highlights its line and announces it to screen readers.
- Accessibility: full keyboard operation; the console panel is an ARIA live region; the canvas has a text-description fallback; theme respects `prefers-color-scheme`. (Ships accessible from Phase 1 — not retrofitted.)

---

## 6. Architecture and stack

### 6.1 Monorepo

```
ignition/
├── packages/
│   ├── core/          # @ignition/core — lexer, parser, semantic, lowering, interpreter, CFG, relooper, emitters. Pure TypeScript, zero DOM deps.
│   ├── rt-js/         # @ignition/rt-js — runtime shared by the interpreter (from Phase 1) and emitted JS
│   ├── rt-rs/         # ignition-rt — Rust crate (published to crates.io)
│   ├── lang-cm/       # @ignition/lang-cm — CodeMirror 6 language support
│   └── examples/      # .bas programs + golden outputs (js, rs, run transcript)
├── apps/
│   └── ide/           # Nuxt 4 + Nuxt UI v4, static build → Netlify
├── tools/
│   └── conformance/   # runs every example through all three backends, diffs transcripts
└── docs/              # this suite (00–12)
```

- **Stack:** Nuxt 4 (Nuxt 5 when stable), Nuxt UI v4, TypeScript, pnpm workspaces, Vitest. `@ignition/core` must stay framework-free so it can run in a Worker, in Node (CLI), and eventually in a VS Code extension.
- **CLI:** `ignition build prog.bas --target js|rust|run` ships from `core` for CI and for people who don't want the IDE.
- **Deploy:** Netlify (static). No functions needed in Phase 1–3.

### 6.2 Conformance testing — the spine of the project

Every example program has three golden files: the expected console transcript, the expected `.js`, and the expected `.rs`. CI runs:

1. interpreter transcript === golden transcript
2. emitted JS, executed under Node with `rt-js` === golden transcript
3. emitted Rust, built with `cargo` (GitHub Actions has a Rust toolchain) === golden transcript
4. emitted sources are byte-identical to golden sources (readability regression guard)

Because all three backends share a seeded PRNG and `INPUT` is scripted from a fixture file in test mode, transcripts are deterministic. A backend disagreeing with the interpreter is a bug in that backend, full stop.

### 6.3 Rust verification from the browser

Netlify cannot run `rustc`. Three escalating options:

| Option | Phase | Trade-off |
|---|---|---|
| **A. Export Cargo project, build locally** | 1 | Always works; no live feedback |
| **B. "Does it compile?" via the Rust Playground API** | 3 (optional) | Public, rate-limited, no guarantees; good enough for a green/red check |
| **C. Build service on the DigitalOcean droplet** (`cargo build --target wasm32-unknown-unknown`, cached by source hash, returns a `.wasm`) | 4 | Enables "Run Rust in the IDE" next to "Run JS" — the best demo in the product. Needs rate limiting and a sandbox (build in a container with a timeout). Flagged: this is the one piece that doesn't fit Netlify. |

### 6.4 Shared core with sibling projects

- **BASIC Museum** can consume `@ignition/core`'s lexer/parser/interpreter for its Level-1-adjacent dialects by supplying a dialect profile (keyword set, `RND` convention, print formatting). Ignition is the "modern" exhibit in the museum; the museum's classic dialects need not share the emitters at all. Phase 1 doesn't build that profile mechanism: the Museum's dialects differ from Ignition in core semantics (−1 as true, bitwise `AND`/`OR`, padded numbers, loops that always run once), so a profile would fork the interpreter. To keep it possible, the formatter, the `RND` mapping and the keyword table each live in one module (Doc 01 §1).
- **Fugløy** needs CFG → structured-code recovery for Z80 → JavaScript. The relooper in `@ignition/core` should take a generic CFG interface (`{ blocks, edges, entry }`) with no BASIC-specific types, so it can be extracted to its own package (`@cschweda/relooper`) later. Design the relooper's input as data, not AST.

---

## 7. Phase plan (summary — Phases 1–5 each get a doc, 01–05)

| Phase | Deliverable | Done when |
|---|---|---|
| **1 — Spark** (release 0.1.0) | `@ignition/core` lexer/parser/semantic/interpreter for the full Level 1 statement set + core functions; `@ignition/rt-js` core (formatter, PRNG, built-ins); IDE shell with Source + Run + Errors tabs, an Index tab with tier and variables, and Run/Stop/Step; console I/O only; examples menu; localStorage save | 10 example programs run with golden transcripts; IDE on Netlify; keyboard-accessible |
| **2 — Structure** | Level 2 constructs in parser + interpreter; Index tab complete (procedures, warnings); CodeMirror grammar complete; RENUM; breakpoints | 20 examples; Index correct for all |
| **3 — JavaScript** | CFG, relooper, GOSUB extraction, JS emitter, `rt-js`; JS tab with cross-highlight; "Run JS" chip in sandboxed iframe; export .js | All 20 examples: emitted JS transcript === interpreter; readability goldens committed |
| **4 — Rust** | Rust emitter; `ignition-rt` crate; Cargo project export; CI builds all examples with cargo; optional Playground compile check | All 20 examples build and match; crate published |
| **5 — Graphics, files, and the live Rust pane** | `SCREEN`/`PSET`/`LINE`/`CIRCLE`, canvas + PNG runtimes; VFS + `OPEN`; droplet build service → WASM → "Run Rust" chip | Side-by-side JS/Rust run of a graphical example in the IDE |
| **6 — Apps** | GUI verb family (§2.8) in `rt-js`; event loop live in the IDE; App exports: single-file HTML, Node CLI, Tauri project (with Rust-backend commands), Electron project | A form-based example exported as a Tauri app builds and runs on macOS/Linux/Windows |

Phase 1 is deliberately interpreter-only. The emitters are the product, but they're useless until the semantics are nailed down by a reference implementation and a test corpus.

---

## 8. Open decisions (to settle before Phase 3)

1. **Rust `PRINT` API shape.** Variadic-via-slice (`&[&dyn Display]`), a `print!`-style macro (`iprint!(a, b; c)`), or emitting a `format!` per `PRINT`. Readability test: which one does a Rust reader not blink at? Leaning macro.
2. **Boolean model.** Confirmed: real booleans, not `-1/0` (§2.7). Open: should `PRINT (1=1)` print `True`, `-1`, or `1`? Leaning `True`/`False` with `OPTION CLASSICPRINT` giving `-1`/`0`. Until it's decided, printing a boolean is a compile-time type error (Doc 01 §4), which keeps every option open.
3. **Top-level JS shape.** `async function main()` vs. top-level `await` in an ES module. Leaning top-level await (cleaner), with a `--cjs` flag for the Node CLI.
4. **GOSUB extraction when a subroutine reads/writes many globals.** Rust is fine (everything's in `main` scope unless extracted → then needs `&mut` params or a `State` struct). Decision: extracted procedures take a `&mut State` struct holding all globals when they touch > 3 of them; otherwise explicit `&mut` params. JS doesn't care (closures). This is the biggest readability fork between the two targets and deserves its own page in Doc 11.
5. **Name.** V8's bytecode interpreter is called Ignition; Inductive Automation sells a SCADA platform called Ignition. Keep for now; revisit before any public launch. Candidate alternates to park: *Kindle* (no), *Spark* (overloaded), *Tinder* (absolutely not), *Flint*, *Striker*, *Pilot* (as in pilot light), *Fuse*.
6. **`ON ERROR GOTO`.** Out for v1; reconsider only if the Rust story (`Result` propagation to a handler) can be made readable.
7. **Structuring algorithm.** Relooper, or the dominator-tree translation in Ramsey's "Beyond Relooper" (ICFP 2022). For reducible graphs Ramsey's never needs a label variable, only nested blocks and loops with labeled `break`/`continue`, which JS and Rust both have. Prototype both on the Phase 1 examples before Phase 3; readability decides.

---

## 9. Differentiation statement (seed for Doc 08)

> Every other BASIC either runs your old programs or compiles to something you'll never read. Ignition compiles to something you'd *write*. It is the only BASIC whose primary output is a diff you can review.

---

## 10. Document map

| Doc | Title |
|---|---|
| 00 | Master Design (this) |
| 01 | Phase 1 — Spark: semantics and execution model (`ignition-01-phase1-semantics.md`) |
| 02 | Phase 2 — Structure (Level 2 + Index) |
| 03 | Phase 3 — JavaScript target |
| 04 | Phase 4 — Rust target |
| 05 | Phase 5 — Graphics, files, live Rust |
| 06 | Security (sandboxed JS execution, build service hardening, URL-encoded programs) |
| 07 | LLM Build Prompt |
| 08 | Differentiation |
| 09 | Monorepo / Website |
| 10 | Revision / Gap Analysis |
| 11 | Architecture Decisions (relooper choice, boolean model, Rust state passing, PRNG) |
| 12 | Use Cases (learner, nostalgic, prototyper, Museum visitor, Fugløy reuse) |

Also in `docs/`: the implementation plan (`ignition-implementation-plan.md`, covering every phase) and the Phase 1 kickoff prompt (`ignition-kickoff-prompt.md`, the first part of Doc 07).
