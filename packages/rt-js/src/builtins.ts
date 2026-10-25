/**
 * The built-in functions of Doc 01 §12. Each one checks its own arguments, so the interpreter and
 * (from Phase 3) the emitted JavaScript behave identically. RND is in generator.ts, ROUND in
 * round.ts and VAL in numeric.ts.
 *
 * Rules shared by all of them except STR$: a NaN or infinite numeric argument raises ?FC, an
 * infinite result raises ?OV, and counts and positions are truncated toward zero.
 */
import { checkFinite, checkResult } from './checks.ts'
import { fault } from './errors.ts'
import { formatNumber } from './format.ts'
import { codePointLength, codePoints, sliceCodePoints } from './strings.ts'

/** STRING$ and SPACE$ refuse to build more than this many characters (docs/DECISIONS.md). */
export const MAX_STRING_LENGTH = 16_777_216

/** Truncates a count or position after the NaN/infinity check. */
function whole(fn: string, x: number): number {
  checkFinite(fn, x)
  return Math.trunc(x)
}

export function abs(x: number): number {
  checkFinite('ABS', x)
  return Math.abs(x)
}

export function sgn(x: number): number {
  checkFinite('SGN', x)
  return x > 0 ? 1 : x < 0 ? -1 : 0
}

export function int(x: number): number {
  checkFinite('INT', x)
  return Math.floor(x)
}

export function fix(x: number): number {
  checkFinite('FIX', x)
  return Math.trunc(x)
}

export function sqr(x: number): number {
  checkFinite('SQR', x)
  if (x < 0) fault('FC', `SQR of a negative number (${formatNumber(x)})`)
  return Math.sqrt(x)
}

export function sin(x: number): number {
  checkFinite('SIN', x)
  return Math.sin(x)
}

export function cos(x: number): number {
  checkFinite('COS', x)
  return Math.cos(x)
}

export function tan(x: number): number {
  checkFinite('TAN', x)
  return Math.tan(x)
}

export function atn(x: number): number {
  checkFinite('ATN', x)
  return Math.atan(x)
}

export function exp(x: number): number {
  checkFinite('EXP', x)
  return checkResult('EXP', Math.exp(x))
}

export function log(x: number): number {
  checkFinite('LOG', x)
  if (x <= 0) fault('FC', `LOG of ${formatNumber(x)}; the argument must be above 0`)
  return Math.log(x)
}

/** MIN(a, b, …): the smallest; on a tie (including 0 and -0) the earliest argument wins. */
export function min(...values: number[]): number {
  for (const v of values) checkFinite('MIN', v)
  let best = values[0] ?? 0
  for (const v of values) if (v < best) best = v
  return best
}

/** MAX(a, b, …): the largest; on a tie (including 0 and -0) the earliest argument wins. */
export function max(...values: number[]): number {
  for (const v of values) checkFinite('MAX', v)
  let best = values[0] ?? 0
  for (const v of values) if (v > best) best = v
  return best
}

export function len(s: string): number {
  return codePointLength(s)
}

export function left(s: string, n: number): string {
  const count = whole('LEFT$', n)
  if (count < 0) fault('FC', `LEFT$ count is negative (${count})`)
  return sliceCodePoints(s, 0, count)
}

export function right(s: string, n: number): string {
  const count = whole('RIGHT$', n)
  if (count < 0) fault('FC', `RIGHT$ count is negative (${count})`)
  const points = codePoints(s)
  return points.slice(Math.max(0, points.length - count)).join('')
}

/** MID$(s, start [, len]): 1-based; a start past the end gives "". */
export function mid(s: string, start: number, length?: number): string {
  const from = whole('MID$', start)
  if (from < 1) fault('FC', `MID$ start is ${from}; it must be at least 1`)
  if (length === undefined) return sliceCodePoints(s, from - 1)
  const count = whole('MID$', length)
  if (count < 0) fault('FC', `MID$ length is negative (${count})`)
  return sliceCodePoints(s, from - 1, from - 1 + count)
}

/**
 * INSTR(start, hay, needle): the 1-based position of `needle` at or after `start`, or 0.
 * The interpreter passes 1 when the program leaves `start` out.
 */
export function instr(start: number, hay: string, needle: string): number {
  const from = whole('INSTR', start)
  if (from < 1) fault('FC', `INSTR start is ${from}; it must be at least 1`)
  const h = codePoints(hay)
  const n = codePoints(needle)
  if (n.length === 0) return from <= h.length ? from : 0
  for (let i = from - 1; i + n.length <= h.length; i++) {
    let match = true
    for (let j = 0; j < n.length; j++) {
      if (h[i + j] !== n[j]) {
        match = false
        break
      }
    }
    if (match) return i + 1
  }
  return 0
}

/** STR$(x): the number exactly as PRINT shows it. The one built-in that accepts INF and NAN. */
export function str(x: number): string {
  return formatNumber(x)
}

/** Checks that `n` names a Unicode scalar value and returns it. */
function codePoint(fn: string, n: number): number {
  const c = whole(fn, n)
  if (c < 0 || c > 0x10ffff) fault('FC', `${fn} code point ${c} is outside 0 to 1114111`)
  if (c >= 0xd800 && c <= 0xdfff) fault('FC', `${fn} code point ${c} is a surrogate`)
  return c
}

export function chr(n: number): string {
  return String.fromCodePoint(codePoint('CHR$', n))
}

export function asc(s: string): number {
  const c = s.codePointAt(0)
  if (c === undefined) fault('FC', 'ASC of an empty string')
  return c
}

/** UCASE$: Unicode default case mapping, independent of locale (UCASE$("ß") is "SS"). */
export function ucase(s: string): string {
  return s.toUpperCase()
}

export function lcase(s: string): string {
  return s.toLowerCase()
}

/** TRIM$: removes leading and trailing U+0020 spaces only. */
export function trim(s: string): string {
  return s.replace(/^ +| +$/g, '')
}

/** STRING$(n, c): `n` copies of `c`'s first character, where `c` is a string or a code point. */
export function string(n: number, c: string | number): string {
  const count = whole('STRING$', n)
  if (count < 0) fault('FC', `STRING$ count is negative (${count})`)
  let ch: string
  if (typeof c === 'number') {
    ch = String.fromCodePoint(codePoint('STRING$', c))
  } else {
    const first = codePoints(c)[0]
    if (first === undefined) fault('FC', 'STRING$ of an empty string')
    ch = first
  }
  if (count > MAX_STRING_LENGTH) fault('OM', `STRING$ of ${count} characters`)
  return ch.repeat(count)
}

export function space(n: number): string {
  const count = whole('SPACE$', n)
  if (count < 0) fault('FC', `SPACE$ count is negative (${count})`)
  if (count > MAX_STRING_LENGTH) fault('OM', `SPACE$ of ${count} characters`)
  return ' '.repeat(count)
}
