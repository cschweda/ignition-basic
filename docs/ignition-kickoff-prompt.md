# Ignition — Phase 1 Kickoff Prompt

Start a fresh Claude Code session in the repo root (a clone of `github.com/cschweda/ignition-basic`, which already holds `README.md`, `LICENSE`, `CHANGELOG.md`, `.gitignore`, `.nvmrc` and these docs in `docs/`) and say: *"Read `docs/ignition-kickoff-prompt.md` and follow it."* Keeping the prompt in a file, rather than pasting it, lets the agent re-read it after the session's context is compacted. Everything below the line is the prompt.

---

You are building **Phase 1 ("Spark")** of Ignition: a small 1978-flavored BASIC with a browser IDE that will, in later phases, cross-compile to readable JavaScript and Rust. Phase 1 is interpreter-only. Read:

- `docs/ignition-00-master-design.md` — the language spec; §2 is binding.
- `docs/ignition-01-phase1-semantics.md` — Doc 01, the exact Phase 1 rules. It is binding and wins over §2 wherever they differ; treat its decisions as settled.
- `docs/ignition-implementation-plan.md` — its Phase 1 section is your deliverable list and gate.

Master Design §8 lists the decisions still open; none of them is Phase 1 work. Do not implement anything from Phases 2–6, or from the period dialects (Master Design §9) beyond the hooks in rule 9 below.

## Project identity

- Repo: `github.com/cschweda/ignition-basic`. The product is called **Ignition BASIC**; use the full name in user-facing text (README, IDE title, package descriptions). Packages under the `@ignition/*` npm scope (unpublished; every `package.json` is `"private": true`).
- Author: Christopher Schweda. License: MIT (`LICENSE` is already in the repo).
- The product's eventual purpose is *readable* compiled output. Nothing you write in Phase 1 should make that harder: keep the AST and lowered IR rich with source positions and comments, and keep the interpreter's semantics explicit and documented, because the interpreter is the reference every later emitter is tested against.

## Stack (non-negotiable)

- pnpm workspaces, TypeScript `strict`, Vitest, ESLint (flat config, `eslint.config.mjs`) + Prettier.
- IDE: Nuxt 4, Nuxt UI v4, static generation (`nuxt generate`), deployed to Netlify. Include a `netlify.toml`.
- Editor: CodeMirror 6 with a Lezer grammar (minimal in Phase 1: keywords, numbers, strings, comments, line numbers).
- No backend, no database, no accounts.
- Node 24 LTS (pinned in `.nvmrc`; set `"engines": { "node": ">=24" }`).
- CI: GitHub Actions (`.github/workflows/ci.yml`): frozen-lockfile install, lint, `pnpm test`, generate the IDE, run the end-to-end and axe checks.

## Monorepo layout to create

```
ignition-basic/
├── package.json  pnpm-workspace.yaml  tsconfig.base.json  eslint.config.mjs  .prettierrc  netlify.toml
├── README.md  LICENSE  CHANGELOG.md  .gitignore  .nvmrc       (already present: extend, don't overwrite)
├── CLAUDE.md                  (you create it; see Working method)
├── .github/workflows/ci.yml
├── docs/                      design docs (already present) + DECISIONS.md (you create it)
├── packages/
│   ├── core/                  @ignition/core
│   ├── rt-js/                 @ignition/rt-js: formatter, PRINT/INPUT logic, PRNG, built-ins, error codes
│   ├── lang-cm/               @ignition/lang-cm
│   └── examples/              .bas programs + goldens
├── apps/
│   └── ide/                   Nuxt 4 app
└── tools/
    └── conformance/           golden-transcript runner (Node CLI)
```

## `@ignition/core` and `@ignition/rt-js` — architecture rules

1. **Zero framework and zero platform dependencies** in both packages. No DOM, no Nuxt, no `fs`, no `process` except behind an injected adapter. They must run unchanged in a Web Worker, Node, and Vitest.
2. Pipeline modules in `core`, each with its own tests: `lexer/`, `parser/`, `ast/`, `semantic/`, `lower/` (lowered IR), `interp/`, `index/` (the Index data object), `diagnostics/`. The number formatter, PRINT/INPUT logic, generator, built-in functions and error codes live in `rt-js`, which `core` imports (Doc 01 §16). Phase 3's emitted JavaScript will import the same `rt-js` functions; that is what keeps Live and JS runs identical.
3. Every token, AST node, and IR node carries `{ line, col }` (1-based source position) and, for statements, the Ignition line number (`lineno`). Comments (`REM`, `'`) are first-class nodes that survive lowering. Later emitters depend on this.
4. The interpreter exposes a **step-driven** API, not a blocking `run()` (full signatures: Doc 01 §16):
   ```ts
   const { program, index, errors } = compile(source)
   const vm = createVM(program, { console: ConsoleAdapter, clock?: () => number, entropy?: () => number })
   vm.step(): 'running' | 'waiting-input' | 'idle' | 'ended' | 'error'
   vm.run(budget?: number)        // runs up to N statements then yields; returns the status
   vm.provideInput(text: string)
   vm.dispatch(event: { kind: string, id: string, data?: unknown })
   vm.currentLine(): number | null
   vm.error(): IgnitionError | null
   ```
   The IDE drives it from a Worker; the conformance tool drives it from Node. Neither may block. The program lowers to a flat instruction list, and all control state (program counter, GOSUB frames, FOR loop records, DATA pointer, generator) is plain data on the VM, never the host call stack. That is what lets Phase 2 add SUB/FUNCTION without rewriting the interpreter.

   **The `idle` state and `dispatch` are a hook for a later phase (Master Design §2.8) and must be built now**, even though no Phase 1 program can reach them: implement a handler registry (`registerHandler(kind, id, target)` where `target` is a GOSUB line or a SUB name), a FIFO event queue, and the rule that `dispatch` runs one handler to completion (`RETURN`/`END SUB`) and then returns the VM to `idle`; handlers are never re-entered. Expose an internal-only way to force a VM into `idle` so this path can be unit-tested with a synthetic event in Phase 1. Do not add any GUI verb.
5. `ConsoleAdapter` interface: `print(text: string)`, `newline()`, `cls()`, `requestInput(prompt: string)`. The VM prints prompts, input echoes and error lines itself; `requestInput` only signals the wait and supplies a label. PRINT zone logic (`;` `,` `TAB()`) lives in `rt-js`, not in adapters, so every adapter prints identically.
6. **Semantics are Master Design §2 plus Doc 01, exactly.** Doc 01 is the complete rulebook; these are the rules most easily gotten wrong:
   - Comparisons yield booleans. `AND`/`OR`/`NOT` are logical and short-circuit. There is no `-1`-as-true: `IF X THEN` with a numeric `X` is a compile-time type error.
   - No implicit string/number coercion: `"A" + 1` is a compile-time type error, and READ and INPUT never convert either.
   - Evaluation is left to right everywhere; this is observable through `RND` and through errors.
   - Numbers are f64. `%` variables truncate on assignment and must fit ±(2^53 − 1) (`?OV`). `\` and `MOD` operate on truncated values. Division by zero is a runtime error, never `Infinity`.
   - `PRINT 3` prints `3` (no leading/trailing space). Other numbers print with up to 15 significant digits by Doc 01 §6's algorithm (`0.1 + 0.2` prints `0.3`). `OPTION CLASSICPRINT` is Phase 2; ignore it.
   - Strings are sequences of code points: `LEN`, `MID$` and the rest count code points, not UTF-16 units.
   - Arrays: zero-based, `DIM` required for sizes > 10; undeclared array use implicitly DIMs 0–10 and emits an Index warning.
   - `FOR` tests before the body (`FOR I = 10 TO 1` runs zero times), pairs with its `NEXT` by position in the source, and can't be jumped into. After a normal exit the loop variable equals the first value that failed the test (classic semantics). Nested `NEXT` with explicit variable names must be checked.
   - `RND(1)` → [0,1); `RND(0)` → repeat last; `RND(n>1)` → integer 1..n. The generator is xorshift128+ seeded through SplitMix64, exactly as Doc 01 §13 specifies, and must reproduce its test vectors. `RANDOMIZE n` seeds it; the default seed is fixed (0), so unseeded programs are still deterministic.
   - Errors carry the Ignition line and use classic names: `?SN ERROR`, `?RG ERROR`, `?BS ERROR`, `?/0 ERROR`, `?UL ERROR` (undefined line), `?NF ERROR` (NEXT without FOR), `?TM ERROR` (type mismatch), `?OD ERROR` (out of DATA), plus `?FC`, `?OV`, `?DD` and `?OM` (Doc 01 §15). The console shows `?BS ERROR IN 120`.
7. The semantic pass produces the `Index` object exactly as Doc 01 §17 defines it (tier, lines, variables, procedures, lineMap, warnings). Tier is always `'L1'` in Phase 1 and `procedures` stays empty, but every field must exist.
8. Keywords and identifiers are case-insensitive. Preserve the user's identifier casing in the AST (`display` field); normalize in a `canonical` field. Reserve every keyword Doc 01 §3 lists, including those whose statements arrive in later phases.
9. **Period-dialect hooks, and nothing more** (Doc 01 §16). `compile(source, { dialect })` accepts only `'ignition'`. The keyword table, number formatter, PRINT rules, INPUT parser, `RND` mapping and error texts sit behind one profile object. Lowering, not the parser, places a FOR loop's test. Implement no period-dialect behavior, not even behind a flag.

## Statement and function coverage (Phase 1)

Statements: `LET` (optional keyword) · `PRINT` with `;` `,` `TAB(n)` · `INPUT ["prompt";|,] var[, var…]` · `IF expr THEN (lineno | stmts) [ELSE (lineno | stmts)]` single-line only · `FOR v = a TO b [STEP s]` / `NEXT [v[, v…]]` · `GOTO` · `GOSUB` / `RETURN` · `ON expr GOTO/GOSUB list` · `DIM` · `DATA` / `READ` / `RESTORE [lineno]` · `END` · `STOP` · `REM` and `'` · `RANDOMIZE [n]` · `CLS`.
Multiple statements per line with `:`. Lexical extras from Master Design §2.2: `&H` hex literals, and `#`/`!` sigils (accepted and ignored). Not in Phase 1: `LOCATE` (Phase 5), `OPTION BASE`, `OPTION CLASSICPRINT`, `_` continuation, `BAND`/`BOR`/`BXOR`/`BNOT`, and everything Level 2.

Functions: `ABS SGN INT FIX SQR SIN COS TAN ATN EXP LOG RND ROUND(x[,n]) MIN MAX LEN LEFT$ RIGHT$ MID$ INSTR STR$ VAL CHR$ ASC UCASE$ LCASE$ TRIM$ STRING$ SPACE$ TIMER`. `MID$` as a statement (`MID$(A$,2,3) = "xyz"`) is included. `MIN`/`MAX` take two or more arguments; `TAB` is valid only inside PRINT. Exact definitions: Doc 01 §12.

Operators and precedence per Master Design §2.7 (table in Doc 01 §5). `^` is right-associative and binds tighter than unary minus (`-2^2` = `-4`).

## `packages/examples`

Ten programs, each in `NN-name/program.bas` with one or more cases: `transcript.txt` (expected console output) plus `input.txt` when the program reads input, and named cases (`<case>.transcript.txt` / `<case>.input.txt`) where one run can't cover everything; example 10 has one case per error. File formats and runner rules: Doc 01 §18. The ten are listed in the implementation plan, Phase 1. Write each program so it exercises exactly the behavior its name promises, keep them under ~60 lines, and make them pleasant to read — they will be the IDE's Examples menu and the first thing a visitor sees.

**Write the programs and their transcripts from the spec before the interpreter exists** (see Working method). Take `RND` values and number formatting from `rt-js`, which by then is tested against Doc 01's vectors. If the interpreter and a transcript later disagree, the spec wins and the interpreter is fixed. Change a golden only for a reason in the spec, recorded in `docs/DECISIONS.md`; never regenerate goldens from interpreter output.

## `tools/conformance`

A Node CLI: `pnpm conform [name]`. For each example case, runs the interpreter with the scripted input, captures console output through a string adapter, diffs against the transcript, prints a unified diff on failure, exits non-zero. It also fails a case that asks for more input than it was given, leaves input lines unused, or runs more than 10,000,000 statements, and it uses the virtual clock and fixed entropy (Doc 01 §14). Wired into `pnpm test`.

## `apps/ide` — Phase 1 scope

- Layout: resizable two-pane. Left: source editor. Right: tabs **Run** · **Errors** · **Index** (Index shows tier and the variable table only). Tabs for JavaScript and Rust are present but disabled with a tooltip "Phase 3" / "Phase 4"; use `aria-disabled` rather than `disabled` so keyboard users can reach them and read why.
- Top bar: **Run**, **Stop**, **Step**; target chips **Live** (active), **JS**, **Rust** (disabled the same way). Menus: File (New, Save — downloads the program as a `.bas` file, Load — opens a `.bas` file, Share link), Examples (from `packages/examples`), Settings (theme, font size, keyword auto-uppercase toggle; auto-uppercase never touches strings or comments).
- The interpreter runs in a **Web Worker**. Run drives `vm.run(budget)` in a loop with `postMessage` output batches; Stop terminates the Worker; Step runs one statement, highlights `vm.currentLine()` in the editor gutter, and announces it ("Paused at line 120") in a polite status live region, because the highlight alone is visual only.
- Output floods are normal (`10 PRINT "X";: GOTO 10`). Batch output, apply backpressure so the Worker can't outrun the page, cap the console's scrollback (for example the last 2,000 lines), and throttle live-region announcements so a screen reader isn't buried. The IDE must stay responsive and Stop must always work.
- Run tab: a console panel that is an ARIA live region (`aria-live="polite"`, `role="log"`), with an inline INPUT field that appears on `requestInput`, is labeled with the prompt, and takes focus. CLS clears it.
- Errors tab: compile errors and Index warnings (e.g. implicit DIM) as a list; clicking one moves the editor cursor to the line. Runtime errors appear with the line and the classic error name.
- Persistence: autosave the current program to `localStorage`; "Share link" encodes the source LZ-compressed in the URL fragment and loading the page with a fragment opens it. Opening a share link never overwrites the autosaved program without asking and never starts running on its own. Code from a fragment is never executed outside the Worker.
- Accessibility: every control reachable and operable by keyboard; visible focus; respects `prefers-color-scheme`; editor and console both announce properly to a screen reader. Run axe in CI (`@axe-core/playwright` against the generated site) in several states, not just page load: an INPUT waiting, the Errors tab with entries, each menu open.
- Status bar: tier · line count · compile time · error count.

## Working method

- **First,** write a short `CLAUDE.md` at the repo root holding the rules that must survive a long session: the stack; the `core`/`rt-js` purity rule; "Doc 01 and Master Design §2 are binding, and the spec beats the interpreter"; no unlisted features; the golden policy; the `DECISIONS.md` habit. The repo is already a git repository with `origin` at `github.com/cschweda/ignition-basic`.
- **Then build, in order,** with tests at each layer: monorepo skeleton → `rt-js` (formatter, generator, built-ins, tested against every Doc 01 vector first) → lexer → parser → **the ten examples and their transcripts** (the programs must parse; the transcripts come from the spec) → semantic pass → lowering → interpreter → conformance green.
- **Checkpoint 1: stop there.** When `pnpm test` is green (unit tests plus every golden case), commit, push, report, and stop. Christopher reviews `docs/DECISIONS.md` and the goldens before the IDE starts; the IDE is a second session.
- Commit after each green layer with a descriptive message, and push at each checkpoint so CI runs. Record user-visible changes under `[Unreleased]` in `CHANGELOG.md` as you go. Every `package.json` starts at version `0.1.0`; passing the Phase 1 gate is release 0.1.0.
- Create a task list and keep it current. After each layer, run the tests and report the result in one or two lines; don't narrate.
- When the spec is silent, choose the behavior that will produce the most readable compiled code later, write the choice into `docs/DECISIONS.md` with one line of reasoning, and continue. Do not stop to ask unless the choice would be expensive to reverse — and anything that changes a golden is expensive to reverse.
- Do not add any language feature not listed above, however small. Note temptations in `docs/DECISIONS.md` under "Deferred."

## Done means

**Checkpoint 1 (core):**

- `pnpm install && pnpm test` is green from a clean clone: unit tests (including every Doc 01 test vector) plus every conformance case of all ten examples.

**Checkpoint 2 (IDE): the Phase 1 gate, release 0.1.0:**

- `pnpm --filter ide generate` produces a static site, and `netlify.toml` points Netlify at it.
- Playwright end-to-end tests, run in CI, cover: loading every example, running it and comparing the console with its transcript; stopping `10 GOTO 10` and `10 PRINT "X";: GOTO 10` with the page still responsive; Step highlighting and announcing lines; completing an INPUT program with the keyboard only; and axe reporting no violations in the states listed above.
- Lighthouse accessibility ≥ 95 on the generated site.
- `README.md`'s Getting started section is accurate: how to run the tests, and how to run the IDE locally.
- `CHANGELOG.md` has its 0.1.0 entry ready.
- Christopher does the manual checks: a keyboard pass, an NVDA or VoiceOver smoke test, and the first Netlify deploy.
