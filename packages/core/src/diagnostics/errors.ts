import { ERROR_NAMES } from '@ignition/rt-js'
import type { ErrorCode } from '@ignition/rt-js'

/**
 * A 1-based position in the source text. `line` counts text lines, not Ignition line numbers;
 * `col` counts UTF-16 units, which is what editors use.
 */
export interface Pos {
  line: number
  col: number
}

/** The error object shared by compile-time and runtime errors (Doc 01 §15). */
export interface IgnitionError {
  code: ErrorCode
  /** The long form for the IDE, e.g. "Subscript out of range: A(11), upper bound 10". */
  message: string
  /** The Ignition line number, when known. */
  lineno: number | null
  pos: Pos | null
  phase: 'compile' | 'runtime'
}

/** Builds a compile-time error whose message is the code's name followed by `detail`. */
export function compileError(
  code: ErrorCode,
  detail: string,
  pos: Pos | null,
  lineno: number | null,
): IgnitionError {
  return { code, message: `${ERROR_NAMES[code]}: ${detail}`, lineno, pos, phase: 'compile' }
}
