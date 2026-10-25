import type { Branch, For, If, LineRef, Program, Stmt } from '../ast/ast.ts'
import type { Analysis } from '../semantic/analyze.ts'
import type { Instr, LoweredProgram, Target } from './ir.ts'

/**
 * Lowers a checked program to the flat instruction list (Doc 01 §16). The program must have
 * passed the semantic pass without errors: lowering relies on its FOR/NEXT pairing and on every
 * jump target existing.
 */
export function lower(program: Program, analysis: Analysis): LoweredProgram {
  return new Lowerer(program, analysis).run()
}

type Fixup = (lineStart: ReadonlyMap<number, Target>) => void

class Lowerer {
  readonly #program: Program
  readonly #analysis: Analysis
  readonly #instrs: Instr[] = []
  readonly #fixups: Fixup[] = []
  readonly #loopIds = new Map<For, number>()
  readonly #forIndex = new Map<For, number>()

  constructor(program: Program, analysis: Analysis) {
    this.#program = program
    this.#analysis = analysis
  }

  run(): LoweredProgram {
    const lineStart = new Map<number, Target>()
    for (const line of this.#program.lines) {
      lineStart.set(line.lineno, this.#instrs.length)
      for (const stmt of line.statements) this.#statement(stmt)
    }
    for (const fix of this.#fixups) fix(lineStart)
    return {
      dialect: 'ignition',
      instrs: this.#instrs,
      lineStart,
      data: this.#analysis.data,
      loops: this.#loopIds.size,
    }
  }

  #emit(instr: Instr): number {
    this.#instrs.push(instr)
    return this.#instrs.length - 1
  }

  /** Points `set` at the first instruction of a line once every line is placed. */
  #toLine(ref: LineRef, set: (target: Target) => void): void {
    this.#fixups.push((lineStart) => {
      const target = lineStart.get(ref.lineno)
      if (target === undefined) throw new Error(`line ${ref.lineno} was checked but not found`)
      set(target)
    })
  }

  #statement(stmt: Stmt): void {
    const at = { lineno: stmt.lineno, pos: stmt.pos }
    switch (stmt.kind) {
      case 'Let':
        this.#emit({ op: 'let', step: true, stmt, ...at })
        break
      case 'Print':
        this.#emit({ op: 'print', step: true, stmt, ...at })
        break
      case 'Input':
        this.#emit({ op: 'input', step: true, stmt, ...at })
        break
      case 'If':
        this.#if(stmt)
        break
      case 'For': {
        const loop = this.#loopIds.size
        this.#loopIds.set(stmt, loop)
        this.#forIndex.set(stmt, this.#emit({ op: 'for', step: true, stmt, loop, exit: -1, ...at }))
        break
      }
      case 'Next': {
        const loops = this.#analysis.closes.get(stmt) ?? []
        loops.forEach((loop, i) => {
          const forAt = this.#forIndex.get(loop)
          const id = this.#loopIds.get(loop)
          if (forAt === undefined || id === undefined) throw new Error('NEXT before its FOR')
          const part = this.#emit({
            op: 'next',
            step: i === 0,
            loop: id,
            variable: loop.variable,
            body: forAt + 1,
            ...at,
          })
          // A FOR whose test fails at the start continues after its own part of the NEXT.
          const forInstr = this.#instrs[forAt]
          if (forInstr?.op === 'for') forInstr.exit = part + 1
        })
        break
      }
      case 'Goto': {
        const i = this.#emit({ op: 'goto', step: true, target: -1, ...at })
        this.#toLine(stmt.target, (t) => this.#patch(i, 'target', t))
        break
      }
      case 'Gosub': {
        const i = this.#emit({
          op: 'gosub',
          step: true,
          target: -1,
          resume: this.#instrs.length + 1,
          ...at,
        })
        this.#toLine(stmt.target, (t) => this.#patch(i, 'target', t))
        break
      }
      case 'Return':
        this.#emit({ op: 'return', step: true, ...at })
        break
      case 'On': {
        const targets: Target[] = stmt.targets.map(() => -1)
        this.#emit({
          op: 'on',
          step: true,
          selector: stmt.selector,
          mode: stmt.mode,
          targets,
          resume: this.#instrs.length + 1,
          ...at,
        })
        stmt.targets.forEach((ref, k) => this.#toLine(ref, (t) => (targets[k] = t)))
        break
      }
      case 'Dim':
        this.#emit({ op: 'dim', step: true, stmt, ...at })
        break
      case 'Data':
        this.#emit({ op: 'data', step: false, stmt, ...at })
        break
      case 'Read':
        this.#emit({ op: 'read', step: true, stmt, ...at })
        break
      case 'Restore':
        this.#emit({
          op: 'restore',
          step: true,
          dataIndex: stmt.target ? this.#analysis.restoreIndex(stmt.target.lineno) : 0,
          ...at,
        })
        break
      case 'End':
        this.#emit({ op: 'end', step: true, ...at })
        break
      case 'Stop':
        this.#emit({ op: 'stop', step: true, ...at })
        break
      case 'Rem':
        this.#emit({ op: 'rem', step: false, style: stmt.style, text: stmt.text, ...at })
        break
      case 'Randomize':
        this.#emit({ op: 'randomize', step: true, seed: stmt.seed, ...at })
        break
      case 'Cls':
        this.#emit({ op: 'cls', step: true, ...at })
        break
      case 'MidAssign':
        this.#emit({ op: 'mid', step: true, stmt, ...at })
        break
    }
  }

  /**
   * One step evaluates the condition and picks a branch (Doc 01 §16). A THEN branch of statements
   * that is followed by an ELSE branch of statements ends in a helper jump over the ELSE branch.
   */
  #if(stmt: If): void {
    const at = { lineno: stmt.lineno, pos: stmt.pos }
    const ifAt = this.#emit({
      op: 'if',
      step: true,
      cond: stmt.cond,
      whenTrue: -1,
      whenFalse: -1,
      ...at,
    })
    const ifInstr = this.#instrs[ifAt]
    if (ifInstr?.op !== 'if') throw new Error('unreachable')

    const branch = (b: Branch, set: (t: Target) => void): void => {
      if (b.kind === 'Line') {
        this.#toLine(b.target, set)
      } else {
        set(this.#instrs.length)
        for (const s of b.stmts) this.#statement(s)
      }
    }

    branch(stmt.then, (t) => (ifInstr.whenTrue = t))
    if (stmt.else === null) {
      ifInstr.whenFalse = this.#instrs.length
      return
    }
    let jumpAt: number | null = null
    if (stmt.then.kind === 'Stmts' && stmt.else.kind === 'Stmts') {
      jumpAt = this.#emit({ op: 'jump', step: false, target: -1, ...at })
    }
    branch(stmt.else, (t) => (ifInstr.whenFalse = t))
    if (jumpAt !== null) this.#patch(jumpAt, 'target', this.#instrs.length)
  }

  #patch(index: number, field: 'target', value: Target): void {
    const instr = this.#instrs[index]
    if (instr === undefined || !('target' in instr))
      throw new Error(`no target to patch at ${index}`)
    instr[field] = value
  }
}
