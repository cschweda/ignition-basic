/**
 * The operators and storage rules that need more than a bare JavaScript operator (Doc 01 §4 and
 * §5). `+`, `-`, `*` and `^` follow IEEE and need no helper.
 */
import { checkFinite, MAX_SAFE } from './checks.ts'
import { fault } from './errors.ts'
import { formatNumber } from './format.ts'
import { codePoints } from './strings.ts'

/** `/`: IEEE division, except that a divisor of 0 or -0 raises ?/0. */
export function divide(a: number, b: number): number {
  if (b === 0) fault('/0')
  return a / b
}

/** Truncates an operand of `\` or MOD; one that isn't finite or exceeds ±(2^53 - 1) raises ?OV. */
function wholeOperand(op: string, x: number): number {
  if (!Number.isFinite(x) || Math.abs(Math.trunc(x)) > MAX_SAFE) {
    fault('OV', `${formatNumber(x)} is out of range for ${op}`)
  }
  return Math.trunc(x)
}

/** Turns -0 into 0, so integer results match Rust's i64, which has no -0. */
const unsignedZero = (x: number): number => (x === 0 ? 0 : x)

/** `\`: integer division on truncated operands, truncated toward zero (`-7 \ 2` is -3). */
export function intDiv(a: number, b: number): number {
  const x = wholeOperand('\\', a)
  const y = wholeOperand('\\', b)
  if (y === 0) fault('/0')
  // Exact: for |x|, |y| <= 2^53 - 1 the rounding error of x / y is below 1 / y, the smallest gap
  // between the quotient and an integer, so truncation never crosses one.
  return unsignedZero(Math.trunc(x / y))
}

/** MOD: the remainder of the truncated operands, with the sign of the dividend. */
export function mod(a: number, b: number): number {
  const x = wholeOperand('MOD', a)
  const y = wholeOperand('MOD', b)
  if (y === 0) fault('/0')
  return unsignedZero(x % y)
}

/** Storing into a `%` variable: truncate toward zero; out of ±(2^53 - 1), or not finite, is ?OV. */
export function toInteger(x: number): number {
  if (!Number.isFinite(x) || Math.abs(Math.trunc(x)) > MAX_SAFE) {
    fault('OV', `${formatNumber(x)} doesn't fit a % variable`)
  }
  return unsignedZero(Math.trunc(x))
}

/** Compares two strings by code point (Doc 01 §5). Returns a negative number, 0 or a positive one. */
export function compareStrings(a: string, b: string): number {
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const ca = a.codePointAt(i) ?? 0
    const cb = b.codePointAt(j) ?? 0
    if (ca !== cb) return ca < cb ? -1 : 1
    i += ca > 0xffff ? 2 : 1
    j += cb > 0xffff ? 2 : 1
  }
  if (i < a.length) return 1
  if (j < b.length) return -1
  return 0
}

/**
 * The MID$ statement (Doc 01 §12): returns `target` with characters from `start` (1-based)
 * overwritten by `value`. It overwrites the smallest of `length`, LEN(value) and the characters
 * left from `start`, so the result has the same length as `target`.
 */
export function midAssign(
  target: string,
  start: number,
  length: number | undefined,
  value: string,
): string {
  checkFinite('MID$', start)
  const from = Math.trunc(start)
  const t = codePoints(target)
  if (from < 1 || from > t.length)
    fault('FC', `MID$ start is ${from}; the string has ${t.length} characters`)
  let count = Math.min(codePoints(value).length, t.length - from + 1)
  if (length !== undefined) {
    checkFinite('MID$', length)
    const len = Math.trunc(length)
    if (len < 0) fault('FC', `MID$ length is negative (${len})`)
    count = Math.min(count, len)
  }
  const v = codePoints(value)
  for (let k = 0; k < count; k++) t[from - 1 + k] = v[k] ?? ''
  return t.join('')
}
