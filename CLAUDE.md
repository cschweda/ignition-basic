# Ignition BASIC — working rules

These rules hold for every session. Re-read them after a context compaction.

## The spec is binding

- `docs/ignition-01-phase1-semantics.md` (Doc 01) and Master Design §2 define the language. Doc 01 wins where they differ.
- The spec beats the interpreter. When the interpreter and a golden transcript disagree, fix the interpreter, unless the spec says the golden is wrong.
- Build only what Doc 01 and `docs/ignition-kickoff-prompt.md` list. No unlisted feature, however small: write the temptation under "Deferred" in `docs/DECISIONS.md` instead.
- When the spec is silent, choose what will compile to the most readable JavaScript and Rust later, record the choice in `docs/DECISIONS.md` with one line of reasoning, and continue.
- The period dialects (Master Design §9) are not Phase 1 work. Phase 1 builds only their hooks (Doc 01 §16).

## Stack

- Node 24 (`.nvmrc`), pnpm 12 (`packageManager`), TypeScript 6 in strict mode, Vitest, ESLint flat config, Prettier.
- No build step. Workspace packages export their TypeScript sources, and Node 24 runs `.ts` files directly by stripping types. So: erasable syntax only (no `enum`, `namespace` or parameter properties), `import type` for types, and `.ts` extensions on relative imports.

## Purity

- `packages/core` and `packages/rt-js` have no framework or platform dependencies: no DOM, no Node APIs, no `process`, no `console`. Their I/O goes through injected adapters (`ConsoleAdapter`, `clock`, `entropy`). They must run unchanged in a Web Worker, in Node and in Vitest. ESLint and their tsconfigs enforce this.
- The number formatter, the PRINT and INPUT logic, the generator, the built-in functions and the error codes live in `rt-js`. `core` imports them, and Phase 3's emitted JavaScript will too.

## Golden transcripts

- `packages/examples/NN-name/` holds `program.bas` and its cases (Doc 01 §18).
- Transcripts are written from the spec. Never generate or regenerate one from interpreter output.
- A golden changes only for a reason in the spec, and the change is recorded in `docs/DECISIONS.md`.

## Commands

- `pnpm test`: the unit tests, then every golden case. `pnpm conform [name]` runs one example's cases.
- `pnpm lint`, `pnpm typecheck`, `pnpm format`.

## Habits

- Commit after each green layer and push at each checkpoint. Record user-visible changes under `[Unreleased]` in `CHANGELOG.md`.
- Every `package.json` is `"private": true` at version `0.1.0`.
- In user-facing text the product is "Ignition BASIC".
