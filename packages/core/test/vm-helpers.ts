import { compile } from '../src/compile.ts'
import { createVM } from '../src/interp/vm.ts'
import type { ConsoleAdapter, VMStatus } from '../src/interp/vm.ts'

/** A console that records everything, writing CLS as a `[CLS]` line the way transcripts do. */
export function recordingConsole() {
  let out = ''
  const labels: string[] = []
  const console: ConsoleAdapter = {
    print: (text) => {
      out += text
    },
    newline: () => {
      out += '\n'
    },
    cls: () => {
      if (out !== '' && !out.endsWith('\n')) out += '\n'
      out += '[CLS]\n'
    },
    requestInput: (label) => {
      labels.push(label)
    },
  }
  return { console, output: () => out, labels }
}

export interface StartOptions {
  clock?: () => number
  entropy?: () => number
}

/** Compiles `src` (it must compile) and creates a VM with a virtual clock and entropy 0. */
export function start(src: string, options: StartOptions = {}) {
  const { program, errors } = compile(src)
  if (program === null) throw new Error(errors.map((e) => e.message).join('\n'))
  const recorder = recordingConsole()
  let reads = 0
  const vm = createVM(program, {
    console: recorder.console,
    clock: options.clock ?? (() => reads++ / 1000),
    entropy: options.entropy ?? (() => 0),
  })
  return { vm, ...recorder }
}

/** Runs `src` to the end, answering INPUT from `inputs`, and returns its output and final status. */
export function run(src: string, inputs: string[] = [], options: StartOptions = {}) {
  const s = start(src, options)
  const queue = [...inputs]
  let status: VMStatus = 'running'
  for (let guard = 0; guard < 100_000; guard++) {
    status = s.vm.run()
    if (status === 'waiting-input') {
      const line = queue.shift()
      if (line === undefined) throw new Error(`the program asked for more input:\n${s.output()}`)
      s.vm.provideInput(line)
    } else if (status !== 'running') {
      break
    }
  }
  if (queue.length > 0) throw new Error(`input left over: ${queue.join(' | ')}`)
  return { ...s, status }
}

/** The output of running `src`. */
export const output = (src: string, inputs: string[] = []): string => run(src, inputs).output()
