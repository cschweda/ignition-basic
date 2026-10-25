/**
 * The lowered IR (Doc 01 §16): a flat list of instructions with explicit jump targets. The
 * interpreter runs it, and Phase 3's CFG builder will read the same list.
 *
 * Each source statement becomes one *step* instruction. Helpers that move control around inside
 * a statement (the jump over an ELSE branch, the later parts of `NEXT J, I`), comments and DATA
 * are kept but are not steps.
 *
 * Expressions stay as AST nodes, with their source positions.
 */
import type {
  Data,
  DataItem,
  Dim,
  Expr,
  For,
  Input,
  Let,
  MidAssign,
  Print,
  Read,
  VarRef,
} from '../ast/ast.ts'
import type { Pos } from '../diagnostics/errors.ts'

interface At {
  /** The Ignition line number of the statement this instruction came from. */
  lineno: number
  /** That statement's position in the source text. */
  pos: Pos
}

/** An index into {@link LoweredProgram.instrs}; `instrs.length` means the end of the program. */
export type Target = number

export type Instr = At &
  (
    | { op: 'let'; step: true; stmt: Let }
    | { op: 'print'; step: true; stmt: Print }
    | { op: 'input'; step: true; stmt: Input }
    | { op: 'if'; step: true; cond: Expr; whenTrue: Target; whenFalse: Target }
    | { op: 'for'; step: true; stmt: For; loop: number; exit: Target }
    | {
        op: 'next'
        /** True for the first loop a NEXT closes; later parts of `NEXT J, I` are helpers. */
        step: boolean
        loop: number
        variable: VarRef
        /** The instruction after the FOR. */
        body: Target
      }
    | { op: 'goto'; step: true; target: Target }
    | { op: 'gosub'; step: true; target: Target; resume: Target }
    | { op: 'return'; step: true }
    | {
        op: 'on'
        step: true
        selector: Expr
        mode: 'GOTO' | 'GOSUB'
        targets: Target[]
        resume: Target
      }
    | { op: 'dim'; step: true; stmt: Dim }
    | { op: 'read'; step: true; stmt: Read }
    | { op: 'restore'; step: true; dataIndex: number }
    | { op: 'end'; step: true }
    | { op: 'stop'; step: true }
    | { op: 'randomize'; step: true; seed: Expr | null }
    | { op: 'cls'; step: true }
    | { op: 'mid'; step: true; stmt: MidAssign }
    | { op: 'jump'; step: false; target: Target }
    | { op: 'rem'; step: false; style: 'rem' | 'apostrophe'; text: string }
    /** DATA never executes; its items are in {@link LoweredProgram.data}. */
    | { op: 'data'; step: false; stmt: Data }
  )

/** A program ready to run: what `compile` returns as `program`. */
export interface LoweredProgram {
  dialect: 'ignition'
  instrs: Instr[]
  /** Where a jump to each line lands: its first instruction, or the next one after it. */
  lineStart: ReadonlyMap<number, Target>
  /** Every DATA item, in program order. */
  data: DataItem[]
  /** The number of FOR statements; loop ids run from 0. */
  loops: number
}
