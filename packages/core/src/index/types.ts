/**
 * The Index: what the IDE's Index tab shows about a program (Doc 01 §17). Every field exists from
 * Phase 1 on; later phases fill in `procedures` and the Level 2 tier.
 */
export interface IndexVariable {
  /** The display spelling at the first occurrence, with its sigil. */
  name: string
  /** Upper case, with the sigil if it is `$` or `%`. */
  canonical: string
  type: 'number' | 'integer' | 'string'
  array: null | { dims: number; implicit: boolean }
  /** The line number of the first occurrence. */
  firstLine: number
}

export interface IndexWarning {
  lineno: number
  code: string
  message: string
}

export interface Index {
  tier: 'L1'
  /** The period dialects arrive in D1 (Master Design §9). */
  dialect: 'ignition'
  /** Line numbers, in order. */
  lines: number[]
  variables: IndexVariable[]
  /** Filled in Phase 2 (SUB/FUNCTION) and Phase 3 (extracted GOSUBs). */
  procedures: []
  /** Ignition line number → source text line. */
  lineMap: { lineno: number; line: number }[]
  warnings: IndexWarning[]
}
