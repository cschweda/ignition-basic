import type { IgnitionError } from './diagnostics/errors.ts'
import type { Index } from './index/types.ts'
import type { LoweredProgram } from './lower/ir.ts'
import { lower } from './lower/lower.ts'
import { parse } from './parser/parser.ts'
import { IGNITION_PROFILE } from './profile.ts'
import { analyze } from './semantic/analyze.ts'

export interface CompileOptions {
  /**
   * The program's dialect. Phase 1 has only Ignition's; the period dialects arrive in D1
   * (Master Design §9). This option is the hook they will use (Doc 01 §16).
   */
  dialect?: 'ignition'
}

export interface CompileResult {
  /** Null when there is any compile error. Warnings never stop a program (Doc 01 §2). */
  program: LoweredProgram | null
  index: Index
  errors: IgnitionError[]
}

/** Lexes, parses, checks and lowers a program (Doc 01 §16). */
export function compile(source: string, options: CompileOptions = {}): CompileResult {
  const dialect = options.dialect ?? 'ignition'
  if (dialect !== 'ignition') {
    throw new Error(`unknown dialect "${String(dialect)}": Phase 1 has only "ignition"`)
  }
  const parsed = parse(source, IGNITION_PROFILE.keywords)
  const analysis = analyze(parsed.program, { reportLoops: parsed.errors.length === 0 })
  const errors = [...parsed.errors, ...analysis.errors].sort(
    (a, b) => (a.pos?.line ?? 0) - (b.pos?.line ?? 0) || (a.pos?.col ?? 0) - (b.pos?.col ?? 0),
  )
  const program = errors.length === 0 ? lower(parsed.program, analysis) : null
  return { program, index: analysis.index, errors }
}
