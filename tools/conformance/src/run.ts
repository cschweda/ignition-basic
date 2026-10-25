import { compile, createVM } from '@ignition/core'
import type { ConsoleAdapter, VMStatus } from '@ignition/core'

/** A case fails if it runs more statements than this (Doc 01 §18). */
export const STATEMENT_LIMIT = 10_000_000

export interface RunOptions {
  statementLimit?: number
}

export interface RunResult {
  /** The transcript: everything sent to the console, ending with exactly one line break. */
  output: string
  /** Why the case failed regardless of its output, or null. */
  failure: string | null
}

/**
 * Runs one example case the way Doc 01 §18 specifies: scripted input, one line per request; the
 * virtual clock (0.001 s per TIMER read); entropy 0; and CLS written as a `[CLS]` line.
 */
export function runCase(source: string, inputLines: string[], options: RunOptions = {}): RunResult {
  const limit = options.statementLimit ?? STATEMENT_LIMIT
  const { program, errors } = compile(source)
  if (program === null) {
    const list = errors.map((e) => `  ?${e.code} in line ${e.lineno ?? '?'}: ${e.message}`)
    return { output: '', failure: `the program does not compile:\n${list.join('\n')}` }
  }

  let output = ''
  const console: ConsoleAdapter = {
    print: (text) => {
      output += text
    },
    newline: () => {
      output += '\n'
    },
    cls: () => {
      if (output !== '' && !output.endsWith('\n')) output += '\n'
      output += '[CLS]\n'
    },
    requestInput: () => {},
  }
  let reads = 0
  const vm = createVM(program, { console, clock: () => reads++ / 1000, entropy: () => 0 })

  let status: VMStatus = 'running'
  let statements = 0
  let used = 0
  let failure: string | null = null
  while (failure === null && (status === 'running' || status === 'waiting-input')) {
    if (status === 'waiting-input') {
      const line = inputLines[used]
      if (line === undefined) {
        failure = 'the program asked for more input than the input file has'
      } else {
        used++
        status = vm.provideInput(line)
      }
    } else if (statements >= limit) {
      failure = `the program ran more than ${limit.toLocaleString('en-US')} statements`
    } else {
      status = vm.step()
      statements++
    }
  }
  if (failure === null && status === 'idle') failure = 'the program went idle'
  const unused = inputLines.length - used
  if (failure === null && unused > 0) {
    failure = `${unused} input line${unused === 1 ? '' : 's'} left unused`
  }
  if (!output.endsWith('\n')) output += '\n'
  return { output, failure }
}
