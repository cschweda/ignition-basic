/**
 * The reference interpreter (Master Design §3.1, stage 5; Doc 01 §16). It runs the lowered IR
 * one statement at a time, and keeps all control state as plain data, never on the host call
 * stack: the program counter, the frames (each with its return address and FOR loop records),
 * the variables, the DATA pointer, the generator and any pending INPUT. That is what lets a
 * host pause it between any two statements: for INPUT, for Step and for the run budget.
 *
 * Everything a period dialect would change comes from the dialect profile; the arithmetic,
 * formatting and built-ins come from @ignition/rt-js, which Phase 3's emitted JavaScript shares.
 */
import {
  abs,
  asc,
  atn,
  BasicFault,
  chr,
  compareStrings,
  cos,
  createGenerator,
  divide,
  exp,
  fault,
  fix,
  formatNumber,
  instr,
  int,
  intDiv,
  lcase,
  left,
  len,
  log,
  max,
  midAssign,
  min,
  mod,
  Printer,
  randomize,
  right,
  round,
  sgn,
  sin,
  space,
  sqr,
  mid,
  string,
  tabColumn,
  tan,
  toInteger,
  trim,
  ucase,
  val,
} from '@ignition/rt-js'
import type { ConsoleSink, ErrorCode, InputTarget } from '@ignition/rt-js'
import type { Call, Expr, Name, Target, VarRef } from '../ast/ast.ts'
import type { IgnitionError } from '../diagnostics/errors.ts'
import type { Instr, LoweredProgram } from '../lower/ir.ts'
import { IGNITION_PROFILE } from '../profile.ts'
import type { DialectProfile } from '../profile.ts'

/** Where the VM's output goes, and how it asks for input (Doc 01 §16). */
export interface ConsoleAdapter extends ConsoleSink {
  /**
   * The VM has already printed the prompt; this signals the wait and supplies a label, such as
   * the input field's accessible name.
   */
  requestInput(label: string): void
}

export type VMStatus = 'running' | 'waiting-input' | 'idle' | 'ended' | 'error'

export interface VMEvent {
  kind: string
  id: string
  data?: unknown
}

/** A handler for dispatched events: a GOSUB line, or (from Phase 2) a SUB name. */
export type HandlerTarget = { gosub: number } | { sub: string }

export interface VMOptions {
  console: ConsoleAdapter
  /** Seconds, for TIMER. Default: a real monotonic clock. */
  clock?: () => number
  /** A whole number in [0, 2^53), for a bare RANDOMIZE. Default: the platform's crypto. */
  entropy?: () => number
}

export interface VM {
  /** Runs exactly one statement. */
  step(): VMStatus
  /** Runs up to `budget` statements, stopping early at INPUT, the end, an error or idle. */
  run(budget?: number): VMStatus
  /** Echoes and parses a line of input (Doc 01 §8). Calling it when not waiting is a host bug. */
  provideInput(text: string): VMStatus
  /** Queues an event; in the idle state its handler starts at once (Master Design §2.8). */
  dispatch(event: VMEvent): void
  registerHandler(kind: string, id: string, target: HandlerTarget): void
  /** The line of the next statement, or of the one waiting or failing; null when ended or idle. */
  currentLine(): number | null
  error(): IgnitionError | null
}

/** Internal: puts a VM into the idle state. Tests reach it through `interp/testing.ts`. */
export const FORCE_IDLE: unique symbol = Symbol('forceIdle')

export function createVM(program: LoweredProgram, options: VMOptions): VM {
  if (program.dialect !== 'ignition') throw new Error(`unknown dialect "${program.dialect}"`)
  return new Machine(program, options, IGNITION_PROFILE)
}

type Value = number | string | boolean

/** A frame: the main program, a GOSUB activation or a dispatched handler. */
interface Frame {
  /** Where RETURN goes: an instruction index, HANDLER for a dispatched handler, null for main. */
  resume: number | null
  /** FOR loop records, keyed by loop id (Doc 01 §9). */
  loops: Map<number, { limit: number; step: number }>
}

/** The return address of a dispatched handler's frame: its RETURN puts the VM back in idle. */
const HANDLER = -1

/** At most this many GOSUB frames may be active (Doc 01 §9). */
const MAX_GOSUB_DEPTH = 1000

/** At most this many elements in all of an array's dimensions together (Doc 01 §10). */
const MAX_ARRAY_ELEMENTS = 16_777_216

interface ArrayValue {
  bounds: number[]
  strides: number[]
  data: Float64Array | string[]
}

/** A storage location, with its subscripts already evaluated. */
type Place = { kind: 'scalar'; name: Name } | { kind: 'element'; name: Name; indices: number[] }

interface PendingInput {
  instr: Extract<Instr, { op: 'input' }>
  /** Values accepted so far, for the leading targets. */
  values: (number | string)[]
}

function defaultClock(): number {
  const performance = (globalThis as { performance?: { now(): number } }).performance
  return (performance ? performance.now() : Date.now()) / 1000
}

function defaultEntropy(): number {
  const crypto = (globalThis as { crypto?: { getRandomValues(a: Uint32Array): Uint32Array } })
    .crypto
  if (!crypto) throw new Error('no crypto.getRandomValues: pass `entropy` to createVM')
  const words = crypto.getRandomValues(new Uint32Array(2))
  return ((words[0] ?? 0) & 0x1fffff) * 2 ** 32 + (words[1] ?? 0)
}

const handlerKey = (kind: string, id: string): string => `${kind}\u0000${id}`

class Machine implements VM {
  readonly #program: LoweredProgram
  readonly #instrs: Instr[]
  readonly #console: ConsoleAdapter
  readonly #clock: () => number
  readonly #entropy: () => number
  readonly #profile: DialectProfile
  readonly #printer: Printer
  readonly #start: number

  #pc = 0
  /** The instruction being executed, for error reporting. */
  #at = 0
  #status: VMStatus = 'running'
  #error: IgnitionError | null = null
  readonly #frames: Frame[] = [{ resume: null, loops: new Map() }]
  readonly #scalars = new Map<string, number | string>()
  readonly #arrays = new Map<string, ArrayValue>()
  #dataPointer = 0
  readonly #generator = createGenerator()
  #pending: PendingInput | null = null
  readonly #handlers = new Map<string, HandlerTarget>()
  readonly #events: VMEvent[] = []

  constructor(program: LoweredProgram, options: VMOptions, profile: DialectProfile) {
    this.#program = program
    this.#instrs = program.instrs
    this.#console = options.console
    this.#clock = options.clock ?? defaultClock
    this.#entropy = options.entropy ?? defaultEntropy
    this.#profile = profile
    this.#printer = new Printer(options.console, profile.print)
    this.#start = this.#clock()
    this.#settle()
  }

  // ------------------------------------------------------------------------- public API

  step(): VMStatus {
    if (this.#status !== 'running') return this.#status
    const instr = this.#instrs[this.#pc]
    if (instr === undefined) {
      this.#status = 'ended'
      return this.#status
    }
    this.#at = this.#pc
    this.#guard(() => this.#execute(instr))
    this.#settle()
    return this.#status
  }

  run(budget = 10_000): VMStatus {
    for (let i = 0; i < budget && this.#status === 'running'; i++) this.step()
    return this.#status
  }

  provideInput(text: string): VMStatus {
    const pending = this.#pending
    if (this.#status !== 'waiting-input' || pending === null) {
      throw new Error(
        `provideInput was called while the VM is ${this.#status}, not waiting for input`,
      )
    }
    this.#at = this.#pc
    this.#status = 'running'
    this.#printer.text(text)
    this.#printer.newline()
    this.#guard(() => this.#acceptInput(pending, text))
    this.#settle()
    return this.#status
  }

  dispatch(event: VMEvent): void {
    this.#events.push(event)
    if (this.#status === 'idle') this.#startNextHandler()
  }

  registerHandler(kind: string, id: string, target: HandlerTarget): void {
    if ('sub' in target) {
      throw new Error(`a SUB handler (${target.sub}) needs SUB, which arrives in Phase 2`)
    }
    if (!this.#program.lineStart.has(target.gosub)) {
      throw new Error(`there is no line ${target.gosub} for the ${kind} handler of ${id}`)
    }
    this.#handlers.set(handlerKey(kind, id), target)
  }

  currentLine(): number | null {
    switch (this.#status) {
      case 'running':
      case 'waiting-input':
        return this.#instrs[this.#pc]?.lineno ?? null
      case 'error':
        return this.#error?.lineno ?? null
      default:
        return null
    }
  }

  error(): IgnitionError | null {
    return this.#error
  }

  [FORCE_IDLE](): void {
    this.#status = 'idle'
    this.#startNextHandler()
  }

  // ------------------------------------------------------------------------- the step loop

  /** Runs helper instructions (not steps) until the next statement, the end, or a stop. */
  #settle(): void {
    while (this.#status === 'running') {
      const instr = this.#instrs[this.#pc]
      if (instr === undefined) {
        this.#status = 'ended'
        return
      }
      if (instr.step) return
      this.#at = this.#pc
      this.#guard(() => this.#execute(instr))
    }
  }

  /** Runs `body`, turning a runtime fault into the error state (Doc 01 §15). */
  #guard(body: () => void): void {
    try {
      body()
    } catch (e) {
      if (e instanceof BasicFault) this.#fail(e.code, e.message)
      else if (e instanceof RangeError) this.#fail('OM', `Out of memory: ${e.message}`)
      else throw e
    }
  }

  #fail(code: ErrorCode, message: string): void {
    const instr = this.#instrs[this.#at]
    const lineno = instr?.lineno ?? 0
    this.#error = { code, message, lineno, pos: instr?.pos ?? null, phase: 'runtime' }
    this.#status = 'error'
    this.#pending = null
    this.#printer.startLine()
    this.#printer.text(this.#profile.errorLine(code, lineno))
    this.#printer.newline()
  }

  #execute(instr: Instr): void {
    switch (instr.op) {
      case 'let': {
        const place = this.#place(instr.stmt.target)
        this.#store(place, this.#evaluate(instr.stmt.value) as number | string)
        this.#pc++
        break
      }
      case 'print':
        this.#print(instr)
        this.#pc++
        break
      case 'input':
        this.#pending = { instr, values: [] }
        this.#prompt(false)
        break
      case 'if':
        this.#pc = this.#evaluate(instr.cond) ? instr.whenTrue : instr.whenFalse
        break
      case 'for':
        this.#for(instr)
        break
      case 'next':
        this.#next(instr)
        break
      case 'goto':
      case 'jump':
        this.#pc = instr.target
        break
      case 'gosub':
        this.#pushFrame(instr.resume)
        this.#pc = instr.target
        break
      case 'return':
        this.#return()
        break
      case 'on':
        this.#on(instr)
        break
      case 'dim':
        for (const array of instr.stmt.arrays) {
          const bounds = array.bounds.map((b) => this.#number(b))
          this.#dim(array.name, bounds)
        }
        this.#pc++
        break
      case 'read':
        for (const target of instr.stmt.targets) this.#read(target)
        this.#pc++
        break
      case 'restore':
        this.#dataPointer = instr.dataIndex
        this.#pc++
        break
      case 'end':
        this.#status = 'ended'
        break
      case 'stop':
        this.#printer.startLine()
        this.#printer.text(`BREAK IN ${instr.lineno}`)
        this.#printer.newline()
        this.#status = 'ended'
        break
      case 'randomize':
        randomize(
          this.#generator,
          instr.seed === null ? Math.trunc(this.#entropy()) : this.#number(instr.seed),
        )
        this.#pc++
        break
      case 'cls':
        this.#printer.cls()
        this.#pc++
        break
      case 'mid': {
        const { target, start, length, value } = instr.stmt
        const place = this.#place(target)
        const from = this.#number(start)
        const count = length === null ? undefined : this.#number(length)
        const text = this.#evaluate(value) as string
        this.#store(place, midAssign(this.#load(place) as string, from, count, text))
        this.#pc++
        break
      }
      case 'rem':
      case 'data':
        this.#pc++
        break
    }
  }

  // ------------------------------------------------------------------------- statements

  /**
   * PRINT evaluates every item, left to right, before printing any of them (docs/DECISIONS.md),
   * so an item that fails prints nothing from this PRINT.
   */
  #print(instr: Extract<Instr, { op: 'print' }>): void {
    const actions: (() => void)[] = []
    for (const item of instr.stmt.items) {
      switch (item.kind) {
        case 'Expr': {
          const value = this.#evaluate(item.expr)
          if (typeof value === 'number') actions.push(() => this.#printer.number(value))
          else actions.push(() => this.#printer.text(String(value)))
          break
        }
        case 'Tab': {
          const column = tabColumn(this.#number(item.arg))
          actions.push(() => this.#printer.tab(column))
          break
        }
        case 'Comma':
          actions.push(() => this.#printer.comma())
          break
        case 'Semicolon':
          break
      }
    }
    for (const act of actions) act()
    const last = instr.stmt.items.at(-1)
    if (last?.kind !== 'Semicolon' && last?.kind !== 'Comma') this.#printer.newline()
  }

  #for(instr: Extract<Instr, { op: 'for' }>): void {
    const { variable, from, to, step } = instr.stmt
    const start = this.#number(from)
    const limit = this.#number(to)
    const by = step === null ? 1 : this.#number(step)
    this.#store({ kind: 'scalar', name: variable.name }, start)
    const frame = this.#frame()
    if (passes(this.#scalar(variable) as number, limit, by)) {
      frame.loops.set(instr.loop, { limit, step: by })
      this.#pc++
    } else {
      frame.loops.delete(instr.loop)
      this.#pc = instr.exit
    }
  }

  #next(instr: Extract<Instr, { op: 'next' }>): void {
    const frame = this.#frame()
    const record = frame.loops.get(instr.loop)
    const name = instr.variable.name.display
    if (record === undefined) {
      fault('NF', `NEXT ${name} has no active FOR ${name} in this subroutine`)
    }
    const place: Place = { kind: 'scalar', name: instr.variable.name }
    this.#store(place, (this.#scalar(instr.variable) as number) + record.step)
    if (passes(this.#scalar(instr.variable) as number, record.limit, record.step)) {
      this.#pc = instr.body
    } else {
      frame.loops.delete(instr.loop)
      this.#pc++
    }
  }

  #pushFrame(resume: number): void {
    if (this.#frames.length - 1 >= MAX_GOSUB_DEPTH) {
      fault('OM', `more than ${MAX_GOSUB_DEPTH.toLocaleString('en-US')} GOSUBs are active`)
    }
    this.#frames.push({ resume, loops: new Map() })
  }

  #return(): void {
    if (this.#frames.length === 1) fault('RG')
    const frame = this.#frames.pop()
    if (frame?.resume === HANDLER) {
      this.#status = 'idle'
      this.#startNextHandler()
    } else {
      this.#pc = frame?.resume ?? this.#instrs.length
    }
  }

  #on(instr: Extract<Instr, { op: 'on' }>): void {
    const value = this.#number(instr.selector)
    if (!Number.isFinite(value)) fault('FC', `ON needs a finite number, not ${formatNumber(value)}`)
    const k = Math.trunc(value)
    if (k < 0) fault('FC', `ON ${k} is negative`)
    const target = k === 0 ? undefined : instr.targets[k - 1]
    if (target === undefined) {
      this.#pc = instr.resume
      return
    }
    if (instr.mode === 'GOSUB') this.#pushFrame(instr.resume)
    this.#pc = target
  }

  #read(target: Target): void {
    const place = this.#place(target)
    const item = this.#program.data[this.#dataPointer]
    if (item === undefined) fault('OD', 'READ found no more DATA items')
    this.#dataPointer++
    const wantsString = target.name.sigil === '$'
    if (item.kind === 'Number' && wantsString) {
      fault(
        'TM',
        `READ found the number ${item.raw} for the string variable ${target.name.display}`,
      )
    }
    if (item.kind === 'String' && !wantsString) {
      fault(
        'TM',
        `READ found the string "${item.value}" for the numeric variable ${target.name.display}`,
      )
    }
    this.#store(place, item.value)
  }

  // ------------------------------------------------------------------------- INPUT (Doc 01 §8)

  /** Prints the prompt (or `?? ` for the rest of the values) and waits. */
  #prompt(continuing: boolean): void {
    const prompt = this.#pending?.instr.stmt.prompt ?? null
    if (continuing) this.#printer.text('?? ')
    else if (prompt === null) this.#printer.text('? ')
    else this.#printer.text(prompt.separator === ';' ? `${prompt.text}? ` : prompt.text)
    this.#status = 'waiting-input'
    this.#console.requestInput(prompt?.text ?? '?')
  }

  #acceptInput(pending: PendingInput, text: string): void {
    const targets = pending.instr.stmt.targets
    const remaining = targets.slice(pending.values.length)
    const kinds = remaining.map(inputKind)
    const input = this.#profile.input
    const fields =
      remaining.length === 1 && kinds[0] === 'string'
        ? [{ text: input.wholeLine(text), quoted: false }]
        : input.split(text)

    const accepted: (number | string)[] = []
    let valid = fields !== null
    for (
      let k = 0;
      valid && fields !== null && k < Math.min(fields.length, remaining.length);
      k++
    ) {
      const field = fields[k]
      const kind = kinds[k]
      const value = field && kind ? input.convert(field, kind) : null
      if (value === null) valid = false
      else accepted.push(value)
    }
    if (!valid || fields === null) {
      this.#printer.text('?REDO FROM START')
      this.#printer.newline()
      pending.values = []
      this.#prompt(false)
      return
    }
    pending.values.push(...accepted)
    if (fields.length < remaining.length) {
      this.#prompt(true)
      return
    }
    if (fields.length > remaining.length) {
      this.#printer.text('?EXTRA IGNORED')
      this.#printer.newline()
    }
    // Every target has a valid value: now evaluate each target's subscripts and store it.
    this.#pending = null
    pending.values.forEach((value, k) => {
      const target = targets[k]
      if (target) this.#store(this.#place(target), value)
    })
    this.#pc++
  }

  // ------------------------------------------------------------------------- events

  /** Starts the next queued event's handler, skipping events that have none. */
  #startNextHandler(): void {
    while (this.#status === 'idle') {
      const event = this.#events.shift()
      if (event === undefined) return
      const target = this.#handlers.get(handlerKey(event.kind, event.id))
      if (target === undefined || !('gosub' in target)) continue
      this.#frames.push({ resume: HANDLER, loops: new Map() })
      this.#pc = this.#program.lineStart.get(target.gosub) ?? this.#instrs.length
      this.#status = 'running'
      this.#settle()
    }
  }

  // ------------------------------------------------------------------------- storage

  #frame(): Frame {
    const frame = this.#frames.at(-1)
    if (frame === undefined) throw new Error('the main frame is missing')
    return frame
  }

  /** Evaluates a target's subscripts; the store comes later (Doc 01 §5, Assignment). */
  #place(target: Target): Place {
    if (target.kind === 'Var') return { kind: 'scalar', name: target.name }
    return {
      kind: 'element',
      name: target.name,
      indices: target.indices.map((i) => this.#number(i)),
    }
  }

  #scalar(v: VarRef): number | string {
    return this.#scalars.get(v.name.canonical) ?? (v.name.sigil === '$' ? '' : 0)
  }

  #store(place: Place, value: number | string): void {
    const stored = place.name.sigil === '%' ? toInteger(value as number) : value
    if (place.kind === 'scalar') {
      this.#scalars.set(place.name.canonical, stored)
      return
    }
    const array = this.#array(place.name, place.indices.length)
    array.data[this.#offset(array, place.name, place.indices)] = stored as never
  }

  #load(place: Place): number | string {
    if (place.kind === 'scalar') {
      return this.#scalars.get(place.name.canonical) ?? (place.name.sigil === '$' ? '' : 0)
    }
    const array = this.#array(place.name, place.indices.length)
    return array.data[this.#offset(array, place.name, place.indices)] ?? 0
  }

  /** The array called `name`, created with bounds 0 to 10 if this is its first use (Doc 01 §10). */
  #array(name: Name, dims: number): ArrayValue {
    const existing = this.#arrays.get(name.canonical)
    if (existing !== undefined) return existing
    return this.#create(
      name,
      Array.from({ length: dims }, () => 10),
    )
  }

  #dim(name: Name, rawBounds: number[]): void {
    const bounds = rawBounds.map((b) => {
      if (!Number.isFinite(b)) fault('FC', `DIM ${name.display}: a bound of ${formatNumber(b)}`)
      const bound = Math.trunc(b)
      if (bound < 0) fault('FC', `DIM ${name.display}: the bound ${bound} is negative`)
      return bound
    })
    if (this.#arrays.has(name.canonical)) fault('DD', `${name.display}() already exists`)
    this.#create(name, bounds)
  }

  #create(name: Name, bounds: number[]): ArrayValue {
    const size = bounds.reduce((n, b) => n * (b + 1), 1)
    if (size > MAX_ARRAY_ELEMENTS) {
      fault('OM', `${name.display}() would have ${size.toLocaleString('en-US')} elements`)
    }
    const strides = bounds.map(() => 1)
    for (let k = bounds.length - 2; k >= 0; k--) {
      strides[k] = (strides[k + 1] ?? 1) * ((bounds[k + 1] ?? 0) + 1)
    }
    const data = name.sigil === '$' ? new Array<string>(size).fill('') : new Float64Array(size)
    const array = { bounds, strides, data }
    this.#arrays.set(name.canonical, array)
    return array
  }

  /** Where an element lives in `array.data`; a bad subscript raises ?BS (Doc 01 §10). */
  #offset(array: ArrayValue, name: Name, indices: number[]): number {
    let offset = 0
    indices.forEach((raw, k) => {
      const bound = array.bounds[k] ?? 0
      const index = Math.trunc(raw)
      if (!Number.isFinite(raw) || index < 0 || index > bound) {
        const shown = indices
          .map((i) => formatNumber(Number.isFinite(i) ? Math.trunc(i) : i))
          .join(', ')
        const limit = !Number.isFinite(raw)
          ? ''
          : index < 0
            ? ', lower bound 0'
            : `, upper bound ${bound}`
        fault('BS', `${name.display}(${shown})${limit}`)
      }
      offset += index * (array.strides[k] ?? 1)
    })
    return offset
  }

  // ------------------------------------------------------------------------- expressions

  #number(e: Expr): number {
    return this.#evaluate(e) as number
  }

  /**
   * Evaluates an expression, left to right everywhere (Doc 01 §5). Phase 1 expressions call no
   * user code, so recursion here is safe; Phase 2's SUB and FUNCTION calls must not rely on it.
   */
  #evaluate(e: Expr): Value {
    switch (e.kind) {
      case 'Number':
      case 'String':
        return e.value
      case 'Var':
        return this.#scalar(e)
      case 'Index': {
        const place: Place = {
          kind: 'element',
          name: e.name,
          indices: e.indices.map((i) => this.#number(i)),
        }
        return this.#load(place)
      }
      case 'Paren':
        return this.#evaluate(e.expr)
      case 'Call':
        return this.#call(e)
      case 'Unary': {
        const v = this.#evaluate(e.operand)
        if (e.op === 'NOT') return !v
        return e.op === '-' ? -(v as number) : v
      }
      case 'Binary': {
        if (e.op === 'AND')
          return Boolean(this.#evaluate(e.left)) && Boolean(this.#evaluate(e.right))
        if (e.op === 'OR')
          return Boolean(this.#evaluate(e.left)) || Boolean(this.#evaluate(e.right))
        const l = this.#evaluate(e.left)
        const r = this.#evaluate(e.right)
        if (typeof l === 'string' && typeof r === 'string') {
          switch (e.op) {
            case '+':
              return l + r
            case '=':
              return l === r
            case '<>':
              return l !== r
            case '<':
              return compareStrings(l, r) < 0
            case '>':
              return compareStrings(l, r) > 0
            case '<=':
              return compareStrings(l, r) <= 0
            case '>=':
              return compareStrings(l, r) >= 0
            default:
              throw new Error(`${e.op} on strings passed the type checker`)
          }
        }
        const a = l as number
        const b = r as number
        switch (e.op) {
          case '+':
            return a + b
          case '-':
            return a - b
          case '*':
            return a * b
          case '/':
            return divide(a, b)
          case '\\':
            return intDiv(a, b)
          case 'MOD':
            return mod(a, b)
          case '^':
            return a ** b
          case '=':
            return a === b
          case '<>':
            return a !== b
          case '<':
            return a < b
          case '>':
            return a > b
          case '<=':
            return a <= b
          case '>=':
            return a >= b
        }
      }
    }
  }

  /** Calls a built-in, evaluating its arguments left to right first (Doc 01 §5). */
  #call(e: Call): Value {
    const args = e.args.map((a) => this.#evaluate(a))
    const n = (k: number): number => args[k] as number
    const s = (k: number): string => args[k] as string
    switch (e.fn) {
      case 'ABS':
        return abs(n(0))
      case 'SGN':
        return sgn(n(0))
      case 'INT':
        return int(n(0))
      case 'FIX':
        return fix(n(0))
      case 'SQR':
        return sqr(n(0))
      case 'SIN':
        return sin(n(0))
      case 'COS':
        return cos(n(0))
      case 'TAN':
        return tan(n(0))
      case 'ATN':
        return atn(n(0))
      case 'EXP':
        return exp(n(0))
      case 'LOG':
        return log(n(0))
      case 'RND':
        return this.#profile.rnd(this.#generator, n(0))
      case 'ROUND':
        return args.length > 1 ? round(n(0), n(1)) : round(n(0))
      case 'MIN':
        return min(...(args as number[]))
      case 'MAX':
        return max(...(args as number[]))
      case 'LEN':
        return len(s(0))
      case 'LEFT$':
        return left(s(0), n(1))
      case 'RIGHT$':
        return right(s(0), n(1))
      case 'MID$':
        return args.length > 2 ? mid(s(0), n(1), n(2)) : mid(s(0), n(1))
      case 'INSTR':
        return args.length > 2 ? instr(n(0), s(1), s(2)) : instr(1, s(0), s(1))
      case 'STR$':
        return this.#profile.print.formatNumber(n(0))
      case 'VAL':
        return val(s(0))
      case 'CHR$':
        return chr(n(0))
      case 'ASC':
        return asc(s(0))
      case 'UCASE$':
        return ucase(s(0))
      case 'LCASE$':
        return lcase(s(0))
      case 'TRIM$':
        return trim(s(0))
      case 'STRING$':
        return string(n(0), args[1] as number | string)
      case 'SPACE$':
        return space(n(0))
      case 'TIMER':
        return this.#clock() - this.#start
      default:
        throw new Error(`no built-in called ${e.fn}`)
    }
  }
}

/** FOR's test (Doc 01 §9): while v <= limit counting up, while v >= limit counting down. */
function passes(value: number, limit: number, step: number): boolean {
  return step >= 0 ? value <= limit : value >= limit
}

/** What INPUT expects for a target: its sigil decides. */
function inputKind(target: Target): InputTarget {
  return target.name.sigil === '$' ? 'string' : target.name.sigil === '%' ? 'integer' : 'number'
}
