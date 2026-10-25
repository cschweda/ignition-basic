import {
  convertInputField,
  errorLine,
  IGNITION_PRINT_RULES,
  rnd,
  splitInputLine,
  wholeLineField,
} from '@ignition/rt-js'
import type {
  ErrorCode,
  GeneratorState,
  InputField,
  InputTarget,
  PrintRules,
} from '@ignition/rt-js'
import { IGNITION_KEYWORDS } from './lexer/keywords.ts'
import type { KeywordTable } from './lexer/keywords.ts'

/**
 * Everything a period dialect will change, behind one object (Doc 01 §16, Master Design §9).
 * Phase 1 has exactly one profile, Ignition's; the lexer, the interpreter and the rest of the
 * pipeline reach dialect-specific behaviour only through it.
 */
export interface DialectProfile {
  id: 'ignition'
  keywords: KeywordTable
  /** Zone width and number formatting, for PRINT and STR$. */
  print: PrintRules
  /** INPUT's field parser (Doc 01 §8). */
  input: {
    split(line: string): InputField[] | null
    wholeLine(line: string): string
    convert(field: InputField, target: InputTarget): number | string | null
  }
  /** How RND(x) maps onto the generator (Doc 01 §13). */
  rnd(generator: GeneratorState, x: number): number
  /** The console line for a runtime error. */
  errorLine(code: ErrorCode, lineno: number): string
  /** What INPUT and STOP print (Doc 01 §8 and §9). */
  messages: {
    /** After a prompt followed by `;`, or alone when there is no prompt. */
    prompt: string
    /** Asks for the rest of the values. */
    more: string
    redo: string
    extra: string
    breakIn(lineno: number): string
  }
}

export const IGNITION_PROFILE: DialectProfile = {
  id: 'ignition',
  keywords: IGNITION_KEYWORDS,
  print: IGNITION_PRINT_RULES,
  input: { split: splitInputLine, wholeLine: wholeLineField, convert: convertInputField },
  rnd,
  errorLine,
  messages: {
    prompt: '? ',
    more: '?? ',
    redo: '?REDO FROM START',
    extra: '?EXTRA IGNORED',
    breakIn: (lineno) => `BREAK IN ${lineno}`,
  },
}
