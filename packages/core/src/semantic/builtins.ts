/**
 * The argument and result types of the Phase 1 built-in functions (Doc 01 §12), for the type
 * checker. Their behaviour lives in @ignition/rt-js.
 */
export type ParamType = 'number' | 'string' | 'number or string'

export interface Signature {
  params: ParamType[]
  /** How many of the trailing parameters may be left out. */
  optional: number
  /** True when the last parameter may repeat (MIN, MAX). */
  repeats: boolean
  result: 'number' | 'string'
}

const sig = (
  params: ParamType[],
  result: 'number' | 'string',
  optional = 0,
  repeats = false,
): Signature => ({ params, optional, repeats, result })

const numeric = sig(['number'], 'number')

export const SIGNATURES: ReadonlyMap<string, Signature> = new Map([
  ['ABS', numeric],
  ['SGN', numeric],
  ['INT', numeric],
  ['FIX', numeric],
  ['SQR', numeric],
  ['SIN', numeric],
  ['COS', numeric],
  ['TAN', numeric],
  ['ATN', numeric],
  ['EXP', numeric],
  ['LOG', numeric],
  ['RND', numeric],
  ['ROUND', sig(['number', 'number'], 'number', 1)],
  ['MIN', sig(['number', 'number'], 'number', 0, true)],
  ['MAX', sig(['number', 'number'], 'number', 0, true)],
  ['LEN', sig(['string'], 'number')],
  ['LEFT$', sig(['string', 'number'], 'string')],
  ['RIGHT$', sig(['string', 'number'], 'string')],
  ['MID$', sig(['string', 'number', 'number'], 'string', 1)],
  // INSTR([start,] hay, needle): the type checker handles the optional leading start.
  ['INSTR', sig(['number', 'string', 'string'], 'number')],
  ['STR$', sig(['number'], 'string')],
  ['VAL', sig(['string'], 'number')],
  ['CHR$', sig(['number'], 'string')],
  ['ASC', sig(['string'], 'number')],
  ['UCASE$', sig(['string'], 'string')],
  ['LCASE$', sig(['string'], 'string')],
  ['TRIM$', sig(['string'], 'string')],
  ['STRING$', sig(['number', 'number or string'], 'string')],
  ['SPACE$', sig(['number'], 'string')],
  ['TIMER', sig([], 'number')],
])
