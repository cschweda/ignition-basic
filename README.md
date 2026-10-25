# Ignition BASIC

Ignition BASIC is a small, 1978-flavored BASIC with a browser IDE. It runs your program live and, from the same source, emits **readable, idiomatic JavaScript and Rust** you would actually commit. The readability of that output is the product: every other BASIC either runs your old programs or compiles to something you'll never read.

You write the way TRS-80 Level II BASIC taught a generation to write — line numbers, `GOTO`, `GOSUB`, `FOR`/`NEXT` — and see what that program *is* in a modern structured language, line for line, in two language families: dynamic and garbage-collected (JavaScript), and static with ownership (Rust). Clicking a BASIC line highlights the code it became. When tangled source produces awkward output, the IDE shows you why instead of hiding it.

It will also run the classics as they were. A dialect picker switches a program to one of six period BASICs: Microsoft 8K BASIC (Altair), TRS-80 Level II, Commodore BASIC V2 (PET, VIC-20, C64), Applesoft (Apple II), Sinclair BASIC (ZX81 / Timex Sinclair 1000) or Palo Alto Tiny BASIC from *Dr. Dobb's Journal*. A Games menu loads the programs from David Ahl's *BASIC Computer Games* (1978). Both arrive after Phase 2 ([Master Design §9](docs/ignition-00-master-design.md#9-period-dialects)).

> **Status: design complete, code not started.** Phase 1 ("Spark") is next and will ship as **0.1.0**: the Level 1 interpreter, a golden-transcript conformance suite and the browser IDE. Compilation to JavaScript and Rust arrives in Phases 3 and 4.

## A taste

This program, from the [Master Design](docs/ignition-00-master-design.md#4-worked-example):

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

is designed to compile to this JavaScript:

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

## Documentation

| Document | What it covers |
|---|---|
| [Master Design](docs/ignition-00-master-design.md) | The language (§2 is binding), the compiler pipeline, the IDE and the phase plan |
| [Doc 01 — Phase 1 Semantics](docs/ignition-01-phase1-semantics.md) | The exact Phase 1 rules (number formatting, evaluation order, INPUT, FOR/NEXT, errors, the random-number generator), with test vectors |
| [Implementation Plan](docs/ignition-implementation-plan.md) | What each phase builds, in what order, and the gate it must pass |
| [Phase 1 Kickoff Prompt](docs/ignition-kickoff-prompt.md) | The brief for the coding agent that builds Phase 1 |

## Getting started

There's nothing to run yet. Once Phase 1 lands, from a clone:

```bash
nvm use                  # Node 24, from .nvmrc
corepack enable          # or: npm install -g pnpm
pnpm install
pnpm test                # unit tests + golden transcripts
pnpm --filter ide dev    # the IDE, at http://localhost:3000
```

## Planned layout

```
packages/core        @ignition/core     lexer, parser, semantic pass, interpreter (later: CFG, relooper, emitters)
packages/rt-js       @ignition/rt-js    runtime shared by the interpreter and emitted JavaScript
packages/lang-cm     @ignition/lang-cm  CodeMirror 6 language support
packages/examples                       example programs with golden transcripts
apps/ide                                Nuxt 4 IDE: static build, deployed to Netlify
tools/conformance                       runs every example and diffs it against its golden transcript
```

## License

[MIT](LICENSE) © 2026 Christopher Schweda
