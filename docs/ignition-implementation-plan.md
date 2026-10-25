# Ignition — Implementation Plan

**Version:** 0.2 · 2026-10-25 · Christopher Schweda
**Companions:** `ignition-00-master-design.md` (what and why) and `ignition-01-phase1-semantics.md` (Doc 01: the exact Phase 1 rules). This document is the *how* and *in what order*. Each phase ends with something runnable and a test gate that must be green before the next phase begins.

---

## 0. Ground rules for every phase

- **Stack:** pnpm workspaces · TypeScript strict · Vitest · Nuxt 4 + Nuxt UI v4 for the IDE · Netlify static deploy · Rust stable + cargo for the crate.
- **Monorepo:**
  ```
  ignition/
  ├── packages/core        @ignition/core      lexer, parser, semantic, interpreter, cfg, relooper, emitters
  ├── packages/rt-js       @ignition/rt-js     runtime shared by the interpreter (from Phase 1) and emitted JS
  ├── packages/rt-rs       ignition-rt         Rust crate
  ├── packages/lang-cm     @ignition/lang-cm   CodeMirror 6 language
  ├── packages/examples    .bas + goldens (transcript / js / rs)
  ├── apps/ide             Nuxt 4 static app
  ├── tools/conformance    runs examples through every backend, diffs
  └── docs/
  ```
- **No framework code in `core`.** It must import nothing from the DOM, Nuxt, or Node-only APIs (use injected adapters for I/O).
- **Every example program gets a golden transcript the moment it's written.** Goldens are hand-verified once, then frozen.
- **Accessibility is a Phase 1 deliverable, not a later pass.** Keyboard-complete, live-region console, focus-visible, color-scheme aware.
- **Commit the Index data shape early** (variables, procedures, tier, warnings, line map) even before the Index tab exists; later phases fill it.

---

## Phase 1 — Spark: interpreter + IDE shell

**Goal:** A working retro BASIC in the browser. Nothing is compiled yet.

### Deliverables

**`@ignition/core`**
- Lexer with line/col on every token; `REM`/`'` produce comment tokens.
- Recursive-descent parser for the full **Level 1** set: `LET PRINT INPUT IF…THEN[…ELSE] (single line) FOR/NEXT GOTO GOSUB/RETURN ON…GOTO/GOSUB DIM DATA/READ/RESTORE END STOP REM`, plus `RANDOMIZE`, `CLS`. Doc 01 §1 and §3 give the exact in/out list, the lexical extras (`&H`, `#`/`!`) and the keywords to reserve now.
- Expressions per the Master Design grammar; booleans are booleans; no implicit string/number coercion (compile error).
- Core function set: `ABS SGN INT FIX SQR SIN COS TAN ATN EXP LOG RND ROUND MIN MAX LEN LEFT$ RIGHT$ MID$ INSTR STR$ VAL CHR$ ASC UCASE$ LCASE$ TRIM$ STRING$ SPACE$ TIMER`.
- Semantic pass: symbol table, line-number table, `DATA` pool, diagnostics (jump to missing line, `NEXT` without `FOR`, duplicate line, implicit `DIM`, type mismatch). Produces the `Index` object.
- Interpreter over the lowered IR — a flat instruction list, with all control state held as data (Doc 01 §16). Driven by a step function (`step(): 'running' | 'waiting-input' | 'idle' | 'ended' | 'error'`) so a host can run it in a Worker, pause, step, and feed `INPUT`. The `idle` state and `vm.dispatch(event)` exist from Phase 1 as the hook for the Phase 6 event loop (Master Design §2.8): in Phase 1 no program can reach `idle` because no GUI verb exists, but the state machine, the handler registry, and the "run handler to completion, then return to idle" path are implemented and unit-tested with a synthetic event.
- Seeded xorshift128+ PRNG and `RND` exactly as Doc 01 §13 specifies, reproducing its test vectors.
- Errors carry Ignition line numbers; classic names (`?SN ERROR` etc.; the full table is Doc 01 §15).
- I/O through an injected `ConsoleAdapter` interface (`print`, `newline`, `cls`, `requestInput`; Doc 01 §16). `LOCATE` moves to Phase 5.

**`@ignition/rt-js`** (Phase 1 subset) — number formatter, PRINT and INPUT logic, PRNG, built-in functions and error codes, tested against every Doc 01 vector. The interpreter calls it; Phase 3's emitted JS imports the same functions.

**`packages/examples`** — 10 programs with golden transcripts (case and file formats: Doc 01 §18). Each exists to pin one behavior:
1. hello / PRINT zones and `;` `,` `TAB`, number formatting
2. guess-the-number (INPUT including one `?REDO FROM START`, IF, GOTO loop)
3. FOR/NEXT with STEP and nested loops, including a zero-trip loop and the loop-variable-after-exit value
4. GOSUB-heavy (3 subroutines, one called from two sites)
5. ON…GOTO menu
6. DATA/READ/RESTORE, including `RESTORE n` and unquoted strings
7. string functions tour
8. arrays: DIM (1-D and 2-D) and an implicit DIM with its Index warning (`OPTION BASE 1` is Phase 2)
9. RND determinism under RANDOMIZE (matching Doc 01 §13's vectors)
10. every runtime error on purpose via a menu: one case each for `/0`, `BS`, `RG`

**`tools/conformance`** — CLI that runs each example case through the interpreter with scripted INPUT and diffs against its transcript (runner rules: Doc 01 §18). Wired into CI.

**`apps/ide`**
- Two-pane layout; left source, right tabs **Run** and **Errors** (Index tab stubbed with tier + variable table; Index warnings appear in the Errors tab).
- Top bar: Run / Stop / Step; target chips present but only **Live** enabled.
- Editor: CodeMirror 6 with a minimal Lezer grammar (keywords, strings, numbers, comments, line numbers). Full grammar is Phase 2. Keyword auto-uppercase toggle (never touching strings or comments).
- Interpreter runs in a Web Worker; Stop terminates it; Step runs one statement, highlights its line and announces it.
- Console panel is an ARIA live region that survives output floods (batched output, capped scrollback, throttled announcements); INPUT shows an inline prompt field labeled with the prompt.
- Examples menu loads from `packages/examples`.
- Save to localStorage; share via LZ-compressed `#` fragment (opening a share link never silently replaces the autosaved program).
- Deployed to Netlify.

### Gate
- `pnpm test` green: unit tests (including every Doc 01 test vector) + every case of all 10 goldens.
- Playwright end-to-end suite green in CI: every example matches its transcript in the IDE; INPUT completes by keyboard; axe clean across key states.
- Lighthouse accessibility ≥ 95; manual keyboard pass; NVDA or VoiceOver smoke test.
- `10 GOTO 10` and `10 PRINT "X";: GOTO 10` can both be stopped, and the IDE stays responsive.
- Tagged as release 0.1.0.

---

## Phase 2 — Structure: Level 2 + the Index

**Goal:** The structured tier exists, and the IDE can explain a program to you.

### Deliverables
- Parser + interpreter: `WHILE/WEND`, `DO…LOOP WHILE/UNTIL`, block `IF/ELSEIF/ELSE/END IF`, `SELECT CASE`, `SUB`/`FUNCTION`/`END SUB`/`END FUNCTION`, `EXIT`, `CALL`, `CONST`, `OPTION BASE`, `OPTION CLASSICPRINT`, labels, `_` continuation.
- Semantic pass computes **tier** and fills the Index: variables (type, first use), procedures (declared and — placeholder for Phase 3 — extractable GOSUB targets), warnings.
- Full Lezer grammar; CI parses the entire examples corpus with both grammars and fails on disagreement.
- IDE: Index tab live; `RENUM` tool; breakpoints in gutter; pane swap.
- 10 more examples (20 total), including one that uses `OPTION BASE 1` and one program written twice — Level 1 and Level 2 — with identical transcripts. That pair is the seed of the eventual side-by-side demo.

### Gate
- 20 goldens green. Index snapshot tests for all 20. Grammar-parity check in CI.

---

## Period dialects — D1 to D3

**Goal:** Classic listings run as they did on their machines and compile like anything else (Master Design §9). The period dialects are a track beside the numbered phases: D1 lands between Phases 2 and 3, D2 alongside Phase 3, and D3 alongside Phase 4. Doc 13 holds the details, and every rule in it cites a manual page or a reference run.

### D1 — the Microsoft core, TRS-80 Level II and the Games library (after Phase 2)
- `DialectProfile` in `core`: keyword table and tokenizing rules, numeric model, truth value, FOR semantics, how much of a name counts, string and array models, PRINT rules (zones, number padding, line width), error texts and display, `RND` convention, screen size, prompt. Adapted from the BASIC Museum design's §3.1.
- IR additions for faithful semantics: a runtime FOR stack with `NEXT` matched by variable, a deferred syntax error, numeric-model coercions. The Ignition dialect never emits them.
- Two profiles over one Microsoft core:
  - **Microsoft 8K BASIC** (Altair, Rev 4.0): the dialect *BASIC Computer Games* was tested on, so the Games library runs on it.
  - **TRS-80 Level II**: the Microsoft core plus Level II's own rules, among them `RND(0)` for the fraction and `RND(n)` for a whole number from 1 to n.
- `rt-js` modules for both: formatter, numeric model, `RND`, error text.
- IDE: the dialect picker (saved with the program and in share links, shown in the status bar) and the Games menu.
- `packages/games`: the listings from `coding-horror/basic-computer-games` at a pinned commit, unchanged; a manifest per game (title, one-line description, original author where the book credits one, source commit); a scripted session for each.

#### Gate
- Every listing parses under Microsoft 8K BASIC.
- Each runs its scripted session to a normal end, or is listed in its manifest with the reason it can't.
- At least 12 hand-checked transcripts are goldens. Master Design §8.9 decides whether a reference implementation checks the rest.
- An end-to-end test covers switching a program's dialect in the IDE.

### D2 — Commodore BASIC V2 and Applesoft (alongside Phase 3)
- Both are Microsoft 6502 BASICs, so they reuse D1's Microsoft core.
- Commodore BASIC V2 with screen presets for the PET (40 × 25), the VIC-20 (22 × 23) and the Commodore 64 (40 × 25), including the screen-control characters a listing uses inside strings (clear, home, cursor moves).
- Applesoft with `HOME`, `HTAB`, `VTAB`, `INVERSE` and `NORMAL` on a 40 × 24 screen.
- Text only: machine graphics (PETSCII art, `GR`, `HGR`) wait for Phase 5's canvas.

#### Gate
- A tour and a number-guess program with goldens for each dialect; their emitted JS passes Phase 3's transcript gate.

### D3 — Sinclair BASIC and Palo Alto Tiny BASIC (alongside Phase 4)
- Sinclair BASIC as on the ZX81 and Timex Sinclair 1000: mandatory `LET`, slicing (`A$(2 TO 4)`), `PRINT AT` on a 32 × 24 screen, `RAND` and an argument-less `RND`, no `READ`/`DATA`. Keyword entry follows Master Design §8.8.
- Palo Alto Tiny BASIC: 16-bit integers, variables `A`–`Z`, the `@()` array, `PR.`-style abbreviations, and the `WHAT?` / `HOW?` / `SORRY` errors.

#### Gate
- A tour and a number-guess program with goldens for each dialect; their emitted JS and Rust pass the transcript gates.

---

## Phase 3 — JavaScript target

**Goal:** The headline feature. Readable JS from any example.

### Deliverables
- **CFG builder** from lowered IR; generic `{ blocks, edges, entry }` shape with no BASIC types (so Fugløy can reuse it).
- **Pre-passes:** GOSUB extraction (single-entry, all-exits-RETURN, name from preceding `REM` or `sub_<line>`); loop-idiom recovery (`IF cond THEN <earlier line>` → `while`).
- **Relooper** producing structured IR: `Block`, `Loop`, `If`, `Multiple` (label switch) as the fallback. Emits a **relooper report** into the Index: reducible/irreducible regions with a one-line suggestion.
- **JS emitter** (printer over structured IR): hoisted `let` declarations with initial values, comments preserved in place, user names camelCased, `for (…; …; …)` only for clean counted loops, otherwise `while`; `await io.input()`; `// L120` line markers (toggle); imports only what's used.
- **`@ignition/rt-js`**: adds console adapters (DOM + Node) and a scripted-input mode for tests. The formatter, PRNG, PRINT/INPUT logic, built-ins and error type already exist from Phase 1, so Live and JS runs share one implementation.
- **IDE:** JavaScript tab (read-only CM6 view) with **cross-highlighting** both directions via the line map; **JS** target chip runs the emitted code in a sandboxed `allow-scripts` iframe with `rt-js`; Export `.js` / Copy JS.
- Golden `.js` files for all 20 examples (readability regression guard).

### Gate
- For every example: Node-executed emitted JS transcript === interpreter transcript.
- Emitted JS byte-identical to goldens.
- Every Ahl listing that runs under D1 compiles to JS, and its scripted session's JS transcript equals the interpreter's. Readability goldens stay limited to the 20 examples.
- Manual review of the GOSUB-heavy example's output: it must read like a human wrote it, or the pre-pass is adjusted before the gate closes.

---

## Phase 4 — Rust target

**Goal:** Same program, idiomatic Rust, builds with cargo.

### Deliverables
- **Rust emitter** over the same structured IR: `let mut x: f64 = 0.0;` hoisting, `snake_case`, `for i in a..=b` for clean counted loops, `loop`/`break`, `?` on `input`, `main() -> Result<(), IgnitionError>`, `[i as usize]` with runtime bounds check, `format!` for ≥3 string operands.
- **Procedure state rule** (Master Design §8.4): extracted procedures touching ≤3 globals take `&mut` params; >3 take `&mut State`. Decide the `PRINT` API shape (macro vs slice) before writing the first line of the emitter.
- **`ignition-rt` crate:** console (stdout/stdin), PRNG (bit-identical to JS), PRINT zones, `IgnitionError`, scripted-input via env var for tests; features `tty` (`LOCATE`, `INKEY$`) off by default. Published to crates.io; emitted `Cargo.toml` pins the version.
- **Export:** `.zip` Cargo project; Copy Rust.
- **CI:** GitHub Actions job with Rust toolchain builds every example and diffs transcripts.
- **IDE:** Rust tab with cross-highlight; Rust chip shows "Export to run" (live Rust is Phase 5).
- Golden `.rs` files for all 20 examples.

### Gate
- All 20 examples: `cargo build` succeeds, transcript === interpreter transcript, `.rs` byte-identical to goldens.
- `cargo clippy` clean on emitted code for all examples (a cheap, brutal readability test).

---

## Phase 5 — Graphics, files, and live Rust

**Goal:** The side-by-side demo, and the I/O that makes small games possible.

### Deliverables
- Language: `LOCATE` (with a screen model for the console), `SCREEN PSET LINE CIRCLE COLOR PAINT INKEY$ KEY() OPEN/PRINT#/INPUT#/LINE INPUT#/EOF/CLOSE PEEK/POKE BEEP SOUND`.
- `rt-js`: canvas adapter, DOM key state, IndexedDB VFS with import/export, `fetch` for `OPEN "https://…"`, WebAudio.
- `ignition-rt`: framebuffer + PNG dump (`graphics-png` feature), `std::fs`, 64 K byte array, `crossterm` behind `tty`.
- 5 graphical / file examples with goldens (graphics goldens = PNG hash + transcript).
- **Droplet build service:** `POST /build` with source → container `cargo build --target wasm32-unknown-unknown` → cached `.wasm` by source hash; 30 s timeout; rate-limited; no network inside the container. IDE **Rust** chip runs the WASM against a thin JS shim of `ignition-rt`'s I/O.
- IDE: canvas in the Run pane; side-by-side "Live | JS | Rust" split run of one example.

### Gate
- One graphical example runs identically under all three backends in the IDE.
- Build service survives a 100-request burst and a deliberately infinite-loop build.

---

## Phase 6 — Apps: GUI verbs and packaged exports

**Goal:** A BASIC program becomes a thing you can hand to someone — a web page, a CLI, or a native desktop app.

### Deliverables

**Language (Master Design §2.8)**
- GUI verbs: `WINDOW LABEL TEXTBOX BUTTON CHECKBOX LISTBOX LISTADD LISTCLEAR LISTSEL LISTITEM$ GETTEXT$ SETTEXT CHECKED ENABLE SHOW HIDE FOCUS MSGBOX ASKBOX ON CLICK ON CHANGE WAIT`.
- Semantic pass: programs using any GUI verb are labeled "app" in the Index; a GUI program compiled for plain Rust is a compile error with a message pointing at the Tauri export.
- Interpreter: `idle` state becomes reachable; `dispatch` runs GOSUB/SUB handlers to completion with a queue; handlers cannot re-enter.

**`@ignition/rt-js`**
- `ui` module: widget registry keyed by id string, DOM rendering into a container with absolute positioning on an 8 px grid, event binding, `MSGBOX`/`ASKBOX` as accessible dialogs (`<dialog>`), and the `ui.on(id, kind, fn)` surface the JS emitter targets.
- Accessibility baked in: every widget is a native element (`<button>`, `<input>`, `<select size>`), labels are real `<label for>`, focus order is creation order, `FOCUS` moves focus.

**Emitters**
- JS: handlers become named functions (`onSaveClick` from `ON CLICK "save"`, or the SUB's name), registered after setup; `WAIT` emits nothing.
- Rust: **Tauri backend mode** — each SUB/FUNCTION not used as a handler becomes a `#[tauri::command]`; widget accessors are bridged over `invoke`; the generated project's front end is the JS output. Rust emitter refuses GUI programs outside Tauri mode.

**Exports (IDE Export menu and `ignition export --as …` CLI)**
| Export | Produces | Notes |
|---|---|---|
| `html` | one self-contained `.html` with runtime, console, canvas, and `ui` container inlined | Zero-dependency; the default "share an app" path |
| `node` | `.js` + `package.json` | Console/file programs only |
| `tauri` | `src-tauri/` (Rust, with commands from the Rust emitter) + `dist/` (the HTML export) + `tauri.conf.json` | Headline desktop target; ~5 MB binaries; user runs `cargo tauri build` |
| `electron` | `main.js`, `preload.js`, `package.json`, `dist/` | For people who want it; otherwise identical front end |

**IDE**
- Run pane gains an "App" surface (the `ui` container) alongside console and canvas; the event loop is live, so you click buttons in the IDE.
- Export dialog with the four targets and a one-paragraph "what to do next" for each.

**Examples (5)** — a to-do list (TEXTBOX + LISTBOX + BUTTON), a unit converter, a dice roller with a canvas, a text-file viewer (`OPEN` + LISTBOX), and a form that calls a Level 2 FUNCTION so the Tauri export has a real command. Goldens: event-script transcripts (`click save`, `settext name "x"`, …) replacing `input.txt`.

### Gate
- All five app examples run in the IDE by keyboard alone; axe clean.
- The to-do example exported as `html` works from `file://`.
- The to-do example exported as `tauri` builds on macOS, Linux, and Windows in CI (GitHub Actions matrix) and the FUNCTION runs as a Tauri command.
- The same example exported as `electron` builds on at least one platform.

---

## Sequencing notes

- Phases 1 → 2 → 3 are strictly ordered. 4 depends on 3 (shared IR). 5's language additions can start any time after 2; the build service is independent and can be built in parallel with 4.
- Phase 6 depends on 3 (JS emitter) for the `html`, `node`, and `electron` exports and on 4 (Rust emitter) only for Tauri's command generation. A Tauri export with an empty backend is possible after Phase 3; the Rust-command half lands when Phase 4 is done. The GUI verbs themselves need only Phase 2.
- The `idle`/`dispatch` hook in Phase 1 is the only Phase 6 work that happens early, and it is there precisely so Phase 6 never has to reopen the interpreter core.
- The period dialects need Phase 2's interpreter and nothing later. D1 goes before Phase 3 so the structuring work meets real 1978 control flow from its first day; D2 and D3 ride along with Phases 3 and 4 and get JS and Rust output as those phases land. Phase 1's only period-dialect work is the hooks in Doc 01 §16.
- The decision in Phase 4 about the Rust `PRINT` API is the only one that should be made *before* its phase starts, because it affects how much the structured IR needs to carry about PRINT arguments. Settle it at the end of Phase 3.
- If the GOSUB-extraction heuristics turn out to need real tuning, the place to spend the time is Phase 3, on the JS output, where iteration is fastest. Rust inherits the fix for free.

---

## Kickoff

The Phase 1 kickoff prompt is in `ignition-kickoff-prompt.md`. Start a fresh Claude Code session in the repo root, where the prompt, this plan, the Master Design and Doc 01 already sit in `docs/`, and tell it to read and follow the prompt.
