/** The classic two-letter error codes Phase 1 can raise (Doc 01 §15). */
export type ErrorCode =
  'SN' | 'TM' | 'UL' | 'NF' | 'RG' | 'OD' | 'BS' | 'DD' | '/0' | 'FC' | 'OV' | 'OM'

/** The long name behind each code, for the IDE's Errors tab. */
export const ERROR_NAMES: Readonly<Record<ErrorCode, string>> = {
  SN: 'Syntax error',
  TM: 'Type mismatch',
  UL: 'Undefined line',
  NF: 'NEXT without FOR',
  RG: 'RETURN without GOSUB',
  OD: 'Out of DATA',
  BS: 'Subscript out of range',
  DD: 'Redimensioned array',
  '/0': 'Division by zero',
  FC: 'Illegal function call',
  OV: 'Overflow',
  OM: 'Out of memory',
}

/**
 * A runtime error raised inside the runtime library. It knows its code and a readable message;
 * the interpreter (or, later, emitted code) adds the Ignition line number.
 */
export class BasicFault extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, detail?: string) {
    super(detail === undefined ? ERROR_NAMES[code] : `${ERROR_NAMES[code]}: ${detail}`)
    this.name = 'BasicFault'
    this.code = code
  }
}

/** Throws a BasicFault. Typed `never` so callers can use it in expression position. */
export function fault(code: ErrorCode, detail?: string): never {
  throw new BasicFault(code, detail)
}

/** The terse console line for a runtime error, e.g. `?BS ERROR IN 120` (Doc 01 §15). */
export function errorLine(code: ErrorCode, lineno: number): string {
  return `?${code} ERROR IN ${lineno}`
}
