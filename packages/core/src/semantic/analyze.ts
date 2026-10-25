import type {
  Branch,
  DataItem,
  Expr,
  For,
  IndexRef,
  LineRef,
  Next,
  Program,
  Stmt,
  Target,
  VarRef,
} from '../ast/ast.ts'
import { compileError } from '../diagnostics/errors.ts'
import type { IgnitionError, Pos } from '../diagnostics/errors.ts'
import type { Index, IndexVariable, IndexWarning } from '../index/types.ts'
import { SIGNATURES } from './builtins.ts'

/** The type of an expression (Doc 01 §4). `%` is a storage type, so integer variables read as numbers. */
export type ValueType = 'number' | 'string' | 'boolean'

/** A type that already produced an error; it is compatible with everything to avoid repeat errors. */
type Checked = ValueType | 'error'

export interface Analysis {
  errors: IgnitionError[]
  index: Index
  /** The type of every expression that type-checked. */
  types: Map<Expr, ValueType>
  /** For each NEXT, the loops it closes, innermost first. */
  closes: Map<Next, For[]>
  /** For each FOR, the NEXT that closes it and its place in that NEXT's list. */
  closers: Map<For, { next: Next; position: number }>
  /** Every DATA item in program order. */
  data: DataItem[]
  /** The index in `data` of the first item on line `lineno` or later; `data.length` if none. */
  restoreIndex(lineno: number): number
}

export interface AnalyzeOptions {
  /**
   * Report FOR/NEXT pairing errors. The compiler turns this off when the parser already found
   * errors, because a FOR or NEXT on a rejected line would otherwise be reported a second time.
   */
  reportLoops?: boolean
}

/**
 * The semantic pass (Master Design §3.1, stage 3): types, arrays, line numbers in jumps, FOR/NEXT
 * pairing and loop regions, the DATA pool, and the Index.
 */
export function analyze(program: Program, options: AnalyzeOptions = {}): Analysis {
  return new Analyzer(program, options.reportLoops ?? true).run()
}

/** A FOR whose region spans top-level statements `start` to `end`, both inclusive. */
interface Region {
  start: number
  end: number
  forStmt: For
}

class Analyzer {
  readonly #program: Program
  readonly #reportLoops: boolean
  readonly #errors: IgnitionError[] = []
  readonly #warnings: IndexWarning[] = []
  readonly #types = new Map<Expr, ValueType>()
  readonly #closes = new Map<Next, For[]>()
  readonly #closers = new Map<For, { next: Next; position: number }>()
  readonly #data: { lineno: number; item: DataItem }[] = []
  readonly #lines: ReadonlySet<number>

  // Variables in order of first occurrence. Arrays are keyed `NAME()`, apart from scalars.
  readonly #variables = new Map<string, IndexVariable>()
  readonly #dimmed = new Set<string>()
  readonly #arrayUse = new Map<string, { lineno: number; pos: Pos; display: string }>()

  // Top-level statement ordinals, for loop regions (Doc 01 §9).
  readonly #ordinal = new Map<Stmt, number>()
  readonly #lineOrdinal = new Map<number, number>()
  readonly #jumps: { from: number; stmt: Stmt; keyword: string; target: LineRef }[] = []

  #lineno = 0

  constructor(program: Program, reportLoops: boolean) {
    this.#program = program
    this.#reportLoops = reportLoops
    this.#lines = new Set(program.lines.map((l) => l.lineno))
  }

  run(): Analysis {
    this.#numberStatements()
    for (const line of this.#program.lines) {
      this.#lineno = line.lineno
      for (const stmt of line.statements) this.#statement(stmt, this.#ordinal.get(stmt) ?? 0)
    }
    this.#implicitDims()
    const regions = this.#pairLoops()
    this.#checkJumps(regions)

    const errors = [...this.#errors].sort(
      (a, b) => (a.pos?.line ?? 0) - (b.pos?.line ?? 0) || (a.pos?.col ?? 0) - (b.pos?.col ?? 0),
    )
    const data = this.#data.map((d) => d.item)
    const dataLines = this.#data.map((d) => d.lineno)
    return {
      errors,
      index: {
        tier: 'L1',
        dialect: 'ignition',
        lines: this.#program.lines.map((l) => l.lineno),
        variables: [...this.#variables.values()],
        procedures: [],
        lineMap: this.#program.lines.map((l) => ({ lineno: l.lineno, line: l.pos.line })),
        warnings: this.#warnings,
      },
      types: this.#types,
      closes: this.#closes,
      closers: this.#closers,
      data,
      restoreIndex: (lineno) => {
        const i = dataLines.findIndex((l) => l >= lineno)
        return i === -1 ? data.length : i
      },
    }
  }

  #error(code: Parameters<typeof compileError>[0], detail: string, pos: Pos): void {
    this.#errors.push(compileError(code, detail, pos, this.#lineno))
  }

  // --------------------------------------------------------------------------- statement order

  /**
   * Numbers the top-level statements in program order and maps each line to the first statement
   * at or after it, which is where a jump to the line lands.
   */
  #numberStatements(): void {
    let n = 0
    const pending: number[] = []
    for (const line of this.#program.lines) {
      pending.push(line.lineno)
      for (const stmt of line.statements) {
        for (const lineno of pending.splice(0)) this.#lineOrdinal.set(lineno, n)
        this.#ordinal.set(stmt, n++)
      }
    }
    for (const lineno of pending) this.#lineOrdinal.set(lineno, n)
  }

  // --------------------------------------------------------------------------- statements

  #statement(stmt: Stmt, ordinal: number): void {
    switch (stmt.kind) {
      case 'Let': {
        const target = this.#target(stmt.target)
        this.#store(target, this.#expr(stmt.value), stmt.value.pos)
        break
      }
      case 'Print':
        for (const item of stmt.items) {
          if (item.kind === 'Expr') {
            const t = this.#expr(item.expr)
            if (t === 'boolean') {
              this.#error('TM', "a true-or-false value can't be printed", item.expr.pos)
            }
          } else if (item.kind === 'Tab') {
            this.#expect(item.arg, 'number', 'TAB needs a number')
          }
        }
        break
      case 'Input':
      case 'Read':
        for (const t of stmt.targets) this.#target(t)
        break
      case 'If': {
        const t = this.#expr(stmt.cond)
        if (t !== 'boolean' && t !== 'error') {
          this.#error(
            'TM',
            `IF needs a true-or-false condition; to test a number, write IF ${conditionHint(stmt.cond)} <> 0 THEN`,
            stmt.cond.pos,
          )
        }
        this.#branch(stmt, stmt.then, 'THEN', ordinal)
        if (stmt.else) this.#branch(stmt, stmt.else, 'ELSE', ordinal)
        break
      }
      case 'For': {
        const v = this.#target(stmt.variable)
        if (v === 'string') this.#error('TM', 'the FOR variable must be numeric', stmt.variable.pos)
        this.#expect(stmt.from, 'number', 'FOR needs a number to start from')
        this.#expect(stmt.to, 'number', 'FOR needs a number after TO')
        if (stmt.step) this.#expect(stmt.step, 'number', 'STEP needs a number')
        break
      }
      case 'Next':
        for (const v of stmt.variables) this.#target(v)
        break
      case 'Goto':
        this.#jump(stmt, 'GOTO', stmt.target, ordinal)
        break
      case 'Gosub':
        this.#jump(stmt, 'GOSUB', stmt.target, ordinal)
        break
      case 'On':
        this.#expect(stmt.selector, 'number', 'ON needs a number')
        for (const target of stmt.targets) this.#jump(stmt, stmt.mode, target, ordinal)
        break
      case 'Dim':
        for (const array of stmt.arrays) {
          const key = `${array.name.canonical}()`
          this.#dimmed.add(key)
          this.#useArray(array.name, array.bounds.length, array.pos)
          for (const bound of array.bounds)
            this.#expect(bound, 'number', 'array bounds must be numbers')
        }
        break
      case 'Data':
        for (const item of stmt.items) this.#data.push({ lineno: this.#lineno, item })
        break
      case 'Restore':
        if (stmt.target) this.#lineMustExist('RESTORE', stmt.target)
        break
      case 'Randomize':
        if (stmt.seed) this.#expect(stmt.seed, 'number', 'RANDOMIZE needs a number')
        break
      case 'MidAssign': {
        const target = this.#target(stmt.target)
        if (target === 'number')
          this.#error('TM', 'MID$ can only change a string variable', stmt.target.pos)
        this.#expect(stmt.start, 'number', 'the MID$ start must be a number')
        if (stmt.length) this.#expect(stmt.length, 'number', 'the MID$ length must be a number')
        this.#expect(stmt.value, 'string', 'MID$ needs a string to copy in')
        break
      }
      case 'Return':
      case 'End':
      case 'Stop':
      case 'Cls':
      case 'Rem':
        break
    }
  }

  #branch(stmt: Stmt, branch: Branch, keyword: 'THEN' | 'ELSE', ordinal: number): void {
    if (branch.kind === 'Line') {
      this.#jump(stmt, keyword, branch.target, ordinal)
    } else {
      for (const s of branch.stmts) this.#statement(s, ordinal)
    }
  }

  #jump(stmt: Stmt, keyword: string, target: LineRef, from: number): void {
    if (this.#lineMustExist(keyword, target)) this.#jumps.push({ from, stmt, keyword, target })
  }

  #lineMustExist(keyword: string, target: LineRef): boolean {
    if (this.#lines.has(target.lineno)) return true
    this.#error('UL', `${keyword} ${target.lineno}: there is no line ${target.lineno}`, target.pos)
    return false
  }

  /** Records a variable use and returns its type: `$` holds strings, anything else numbers. */
  #target(target: Target): Checked {
    if (target.kind === 'Var') {
      this.#useScalar(target)
    } else {
      this.#useArray(target.name, target.indices.length, target.pos)
      this.#subscripts(target)
    }
    return target.name.sigil === '$' ? 'string' : 'number'
  }

  /** Checks that `value` can be stored into a variable of type `target`. */
  #store(target: Checked, value: Checked, pos: Pos): void {
    if (target === 'error' || value === 'error' || target === value) return
    if (value === 'boolean') {
      this.#error('TM', "a true-or-false value can't be stored in a variable", pos)
    } else {
      this.#error(
        'TM',
        `can't store a ${value} in a ${target} variable; use ${value === 'string' ? 'VAL' : 'STR$'}`,
        pos,
      )
    }
  }

  #useScalar(v: VarRef): void {
    const key = v.name.canonical
    if (!this.#variables.has(key)) {
      this.#variables.set(key, {
        name: v.name.display,
        canonical: key,
        type: storageType(v.name.sigil),
        array: null,
        firstLine: this.#lineno,
      })
    }
  }

  #useArray(
    name: { canonical: string; display: string; sigil: '' | '$' | '%' },
    dims: number,
    pos: Pos,
  ): void {
    const key = `${name.canonical}()`
    const existing = this.#variables.get(key)
    if (existing === undefined) {
      this.#variables.set(key, {
        name: name.display,
        canonical: name.canonical,
        type: storageType(name.sigil),
        array: { dims, implicit: false },
        firstLine: this.#lineno,
      })
      this.#arrayUse.set(key, { lineno: this.#lineno, pos, display: name.display })
    } else if (existing.array && existing.array.dims !== dims) {
      const was = existing.array.dims
      this.#error(
        'BS',
        `${name.display}() has ${was} subscript${was === 1 ? '' : 's'} elsewhere, but ${dims} here`,
        pos,
      )
    }
  }

  #subscripts(ref: IndexRef): void {
    for (const index of ref.indices) this.#expect(index, 'number', 'subscripts must be numbers')
  }

  #implicitDims(): void {
    for (const [key, v] of this.#variables) {
      if (v.array === null || this.#dimmed.has(key)) continue
      v.array.implicit = true
      const use = this.#arrayUse.get(key)
      this.#warnings.push({
        lineno: use?.lineno ?? v.firstLine,
        code: 'IMPLICIT_DIM',
        message: `${v.name}() has no DIM, so it gets bounds 0 to 10 in each dimension`,
      })
    }
  }

  // --------------------------------------------------------------------------- expressions

  /** Type-checks an expression and reports a mismatch with `want`. */
  #expect(e: Expr, want: 'number' | 'string', detail: string): void {
    const t = this.#expr(e)
    if (t !== want && t !== 'error') {
      this.#error('TM', t === 'boolean' ? `${detail}, not a true-or-false value` : detail, e.pos)
    }
  }

  #expr(e: Expr): Checked {
    const t = this.#exprType(e)
    if (t !== 'error') this.#types.set(e, t)
    return t
  }

  #exprType(e: Expr): Checked {
    switch (e.kind) {
      case 'Number':
        return 'number'
      case 'String':
        return 'string'
      case 'Var':
        this.#useScalar(e)
        return e.name.sigil === '$' ? 'string' : 'number'
      case 'Index':
        this.#useArray(e.name, e.indices.length, e.pos)
        this.#subscripts(e)
        return e.name.sigil === '$' ? 'string' : 'number'
      case 'Paren':
        return this.#expr(e.expr)
      case 'Call':
        return this.#call(e.fn, e.args, e.pos)
      case 'Unary': {
        const t = this.#expr(e.operand)
        if (t === 'error') return t
        if (e.op === 'NOT') {
          if (t === 'boolean') return 'boolean'
          this.#error('TM', 'NOT needs a true-or-false operand, such as A > 0', e.pos)
          return 'error'
        }
        if (t === 'number') return 'number'
        this.#error('TM', `unary ${e.op} needs a number`, e.pos)
        return 'error'
      }
      case 'Binary': {
        const left = this.#expr(e.left)
        const right = this.#expr(e.right)
        if (left === 'error' || right === 'error') return 'error'
        switch (e.op) {
          case 'AND':
          case 'OR':
            if (left === 'boolean' && right === 'boolean') return 'boolean'
            this.#error('TM', `${e.op} needs true-or-false operands, such as A > 0`, e.pos)
            return 'error'
          case '=':
          case '<>':
          case '<':
          case '>':
          case '<=':
          case '>=':
            if (left === right && left !== 'boolean') return 'boolean'
            if (left === 'boolean' || right === 'boolean') {
              const other = left === 'boolean' ? right : left
              this.#error(
                'TM',
                other === 'number'
                  ? "a comparison is true or false, not -1 or 0, so it can't be compared with a number"
                  : "true-or-false values can't be compared",
                e.pos,
              )
            } else {
              this.#error('TM', `can't compare a ${left} with a ${right}`, e.pos)
            }
            return 'error'
          case '+':
            if (left === right && left !== 'boolean') return left
            this.#mismatch('+', left, right, e.pos)
            return 'error'
          default:
            if (left === 'number' && right === 'number') return 'number'
            this.#mismatch(e.op, left, right, e.pos)
            return 'error'
        }
      }
    }
  }

  #mismatch(op: string, left: ValueType, right: ValueType, pos: Pos): void {
    if (left === 'boolean' || right === 'boolean') {
      this.#error('TM', `a true-or-false value can't be used with ${op}`, pos)
    } else if (op === '+') {
      this.#error('TM', "can't add a string and a number; use STR$ or VAL", pos)
    } else {
      this.#error('TM', `${op} needs numbers`, pos)
    }
  }

  #call(fn: string, args: Expr[], pos: Pos): Checked {
    const signature = SIGNATURES.get(fn)
    if (signature === undefined) throw new Error(`no signature for ${fn}`)
    const types = args.map((a) => this.#expr(a))
    let params = signature.params
    let min = params.length - signature.optional
    const max = signature.repeats ? Infinity : params.length
    if (fn === 'INSTR') {
      // INSTR([start,] hay, needle): the start is the optional parameter, and it comes first.
      min = 2
      if (args.length === 2) params = ['string', 'string']
    }
    if (args.length < min || args.length > max) {
      this.#error('SN', `${fn} takes ${arity(min, max)}`, pos)
      return 'error'
    }
    let ok = true
    types.forEach((t, i) => {
      const want = params[Math.min(i, params.length - 1)] ?? 'number'
      if (t === 'error') {
        ok = false
      } else if (t === 'boolean') {
        this.#error('TM', `a true-or-false value can't be passed to ${fn}`, args[i]?.pos ?? pos)
        ok = false
      } else if (want !== 'number or string' && t !== want) {
        this.#error(
          'TM',
          `${fn}'s ${ordinalWord(i + 1)} argument must be a ${want}`,
          args[i]?.pos ?? pos,
        )
        ok = false
      }
    })
    return ok ? signature.result : 'error'
  }

  // --------------------------------------------------------------------------- loops

  /**
   * Pairs every NEXT with the innermost open FOR in the same statement list (Doc 01 §9), and
   * returns the regions of the top-level loops.
   */
  #pairLoops(): Region[] {
    const regions: Region[] = []
    const topLevel: Stmt[] = this.#program.lines.flatMap((l) => l.statements)
    this.#pairList(topLevel, regions)
    return regions
  }

  #pairList(list: Stmt[], regions: Region[] | null): void {
    const open: For[] = []
    for (const stmt of list) {
      if (stmt.kind === 'If') {
        if (stmt.then.kind === 'Stmts') this.#pairList(stmt.then.stmts, null)
        if (stmt.else?.kind === 'Stmts') this.#pairList(stmt.else.stmts, null)
      } else if (stmt.kind === 'For') {
        open.push(stmt)
      } else if (stmt.kind === 'Next') {
        const names = stmt.variables.length === 0 ? [null] : stmt.variables
        const closed: For[] = []
        for (const name of names) {
          const loop = open.pop()
          if (loop === undefined) {
            this.#loopError('NF', 'this NEXT has no FOR to close', stmt)
            break
          }
          if (name !== null && name.name.canonical !== loop.variable.name.canonical) {
            this.#loopError(
              'NF',
              `NEXT ${name.name.display} doesn't match the innermost loop, FOR ${loop.variable.name.display} at line ${loop.lineno}`,
              stmt,
            )
            break
          }
          this.#closers.set(loop, { next: stmt, position: closed.length })
          closed.push(loop)
          if (regions) {
            regions.push({
              start: (this.#ordinal.get(loop) ?? 0) + 1,
              end: this.#ordinal.get(stmt) ?? 0,
              forStmt: loop,
            })
          }
        }
        this.#closes.set(stmt, closed)
      }
    }
    for (const loop of open)
      this.#loopError('SN', `FOR ${loop.variable.name.display} has no NEXT`, loop)
  }

  #loopError(code: 'NF' | 'SN', detail: string, stmt: Stmt): void {
    if (!this.#reportLoops) return
    this.#errors.push(compileError(code, detail, stmt.pos, stmt.lineno))
  }

  /** A jump from S to T is legal only if every loop whose region contains T also contains S. */
  #checkJumps(regions: Region[]): void {
    const ordered = [...regions].sort((a, b) => a.start - b.start)
    for (const jump of this.#jumps) {
      const t = this.#lineOrdinal.get(jump.target.lineno) ?? Infinity
      const entered = ordered.find(
        (r) => t >= r.start && t <= r.end && !(jump.from >= r.start && jump.from <= r.end),
      )
      if (entered) {
        this.#errors.push(
          compileError(
            'SN',
            `${jump.keyword} ${jump.target.lineno} jumps into the FOR loop at line ${entered.forStmt.lineno}`,
            jump.target.pos,
            jump.stmt.lineno,
          ),
        )
      }
    }
  }
}

function storageType(sigil: '' | '$' | '%'): IndexVariable['type'] {
  return sigil === '$' ? 'string' : sigil === '%' ? 'integer' : 'number'
}

/** How a numeric condition reads in the hint `IF X <> 0 THEN`. */
function conditionHint(e: Expr): string {
  if (e.kind === 'Var') return e.name.display
  if (e.kind === 'Number') return e.raw
  return '(…)'
}

function arity(min: number, max: number): string {
  if (max === Infinity) return `${min} or more arguments`
  if (min === max) return `${min} argument${min === 1 ? '' : 's'}`
  return `${min} or ${max} arguments`
}

function ordinalWord(n: number): string {
  return ['first', 'second', 'third'][n - 1] ?? `${n}th`
}
