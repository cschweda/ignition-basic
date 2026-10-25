export { compile } from './compile.ts'
export type { CompileOptions, CompileResult } from './compile.ts'
export type { Instr, LoweredProgram as Program } from './lower/ir.ts'
export { createVM } from './interp/vm.ts'
export type {
  ConsoleAdapter,
  HandlerTarget,
  VM,
  VMEvent,
  VMOptions,
  VMStatus,
} from './interp/vm.ts'
export { IGNITION_PROFILE } from './profile.ts'
export type { DialectProfile } from './profile.ts'
export type { IgnitionError, Pos } from './diagnostics/errors.ts'
export type { Index, IndexVariable, IndexWarning } from './index/types.ts'
export { lex } from './lexer/lexer.ts'
export type { LexResult } from './lexer/lexer.ts'
export type { Token } from './lexer/token.ts'
export { parse } from './parser/parser.ts'
export type { ParseResult } from './parser/parser.ts'
export { analyze } from './semantic/analyze.ts'
export type { Analysis, ValueType } from './semantic/analyze.ts'
export type * as Ast from './ast/ast.ts'
