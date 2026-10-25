/**
 * The abstract syntax tree. Every node carries its source position, and every statement its
 * Ignition line number, because the emitters of later phases map each line of output back to
 * them. Comments are statements, so they survive into the output (Master Design §2.2).
 */
import type { Pos } from '../diagnostics/errors.ts'
import type { Sigil } from '../lexer/token.ts'

/** A variable or array name. */
export interface Name {
  /** Upper case, with the sigil if it is `$` or `%`: the variable's identity. */
  canonical: string
  /** As written at this occurrence, sigil included. */
  display: string
  sigil: Sigil
}

// ----------------------------------------------------------------------------- expressions

export type BinaryOp =
  'OR' | 'AND' | '=' | '<>' | '<' | '>' | '<=' | '>=' | '+' | '-' | '*' | '/' | '\\' | 'MOD' | '^'

export interface NumberLit {
  kind: 'Number'
  pos: Pos
  value: number
  /** The literal as written, e.g. `&HFF` or `1.5E3`. */
  raw: string
}

export interface StringLit {
  kind: 'String'
  pos: Pos
  value: string
}

export interface VarRef {
  kind: 'Var'
  pos: Pos
  name: Name
}

/** An array element: `A(I, J)`. */
export interface IndexRef {
  kind: 'Index'
  pos: Pos
  name: Name
  indices: Expr[]
}

/** A built-in function call. `fn` is the keyword, e.g. `LEFT$`; TIMER has no arguments. */
export interface Call {
  kind: 'Call'
  pos: Pos
  fn: string
  args: Expr[]
}

export interface Unary {
  kind: 'Unary'
  pos: Pos
  op: '-' | '+' | 'NOT'
  operand: Expr
}

export interface Binary {
  kind: 'Binary'
  pos: Pos
  op: BinaryOp
  left: Expr
  right: Expr
}

/** Parentheses the programmer wrote, kept so emitters can respect them. */
export interface Paren {
  kind: 'Paren'
  pos: Pos
  expr: Expr
}

export type Expr = NumberLit | StringLit | VarRef | IndexRef | Call | Unary | Binary | Paren

/** Something a value can be stored into. */
export type Target = VarRef | IndexRef

// ----------------------------------------------------------------------------- statements

/** A literal line number used as a jump or RESTORE target. */
export interface LineRef {
  lineno: number
  pos: Pos
}

interface StmtBase {
  pos: Pos
  /** The Ignition line number of the line this statement is on. */
  lineno: number
}

export interface Let extends StmtBase {
  kind: 'Let'
  target: Target
  value: Expr
  /** Whether the optional LET keyword was written. */
  keyword: boolean
}

export type PrintItem =
  | { kind: 'Expr'; expr: Expr }
  | { kind: 'Tab'; pos: Pos; arg: Expr }
  | { kind: 'Semicolon'; pos: Pos }
  | { kind: 'Comma'; pos: Pos }

export interface Print extends StmtBase {
  kind: 'Print'
  items: PrintItem[]
}

export interface Input extends StmtBase {
  kind: 'Input'
  prompt: { text: string; separator: ';' | ',' } | null
  targets: Target[]
}

export type Branch = { kind: 'Line'; target: LineRef } | { kind: 'Stmts'; stmts: Stmt[] }

export interface If extends StmtBase {
  kind: 'If'
  cond: Expr
  then: Branch
  else: Branch | null
}

export interface For extends StmtBase {
  kind: 'For'
  variable: VarRef
  from: Expr
  to: Expr
  step: Expr | null
}

export interface Next extends StmtBase {
  kind: 'Next'
  /** Empty for a bare NEXT. */
  variables: VarRef[]
}

export interface Goto extends StmtBase {
  kind: 'Goto'
  target: LineRef
}

export interface Gosub extends StmtBase {
  kind: 'Gosub'
  target: LineRef
}

export interface Return extends StmtBase {
  kind: 'Return'
}

export interface On extends StmtBase {
  kind: 'On'
  selector: Expr
  mode: 'GOTO' | 'GOSUB'
  targets: LineRef[]
}

export interface DimArray {
  pos: Pos
  name: Name
  bounds: Expr[]
}

export interface Dim extends StmtBase {
  kind: 'Dim'
  arrays: DimArray[]
}

export type DataItem =
  | { kind: 'Number'; pos: Pos; value: number; raw: string }
  | { kind: 'String'; pos: Pos; value: string; quoted: boolean }

export interface Data extends StmtBase {
  kind: 'Data'
  items: DataItem[]
}

export interface Read extends StmtBase {
  kind: 'Read'
  targets: Target[]
}

export interface Restore extends StmtBase {
  kind: 'Restore'
  target: LineRef | null
}

export interface End extends StmtBase {
  kind: 'End'
}

export interface Stop extends StmtBase {
  kind: 'Stop'
}

export interface Rem extends StmtBase {
  kind: 'Rem'
  style: 'rem' | 'apostrophe'
  /** The raw text after REM or '. */
  text: string
}

export interface Randomize extends StmtBase {
  kind: 'Randomize'
  seed: Expr | null
}

export interface Cls extends StmtBase {
  kind: 'Cls'
}

/** The MID$ statement: `MID$(V$, start [, len]) = E$`. */
export interface MidAssign extends StmtBase {
  kind: 'MidAssign'
  target: Target
  start: Expr
  length: Expr | null
  value: Expr
}

export type Stmt =
  | Let
  | Print
  | Input
  | If
  | For
  | Next
  | Goto
  | Gosub
  | Return
  | On
  | Dim
  | Data
  | Read
  | Restore
  | End
  | Stop
  | Rem
  | Randomize
  | Cls
  | MidAssign

// ----------------------------------------------------------------------------- program

export interface Line {
  lineno: number
  pos: Pos
  statements: Stmt[]
}

export interface Program {
  lines: Line[]
}
