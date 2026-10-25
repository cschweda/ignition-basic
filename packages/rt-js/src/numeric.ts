import { MAX_SAFE } from './checks.ts'
import { fault } from './errors.ts'

/** A number found by {@link scanNumeric}. */
export interface ScannedNumber {
  value: number
  /** Index just past the number. */
  end: number
  /** True for a decimal that isn't finite, or hex above 2^53 - 1. */
  outOfRange: boolean
}

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9'
const isHexDigit = (c: string | undefined): boolean => c !== undefined && /^[0-9A-Fa-f]$/.test(c)

/**
 * Matches the numeric grammar shared by DATA, INPUT and VAL (Doc 01 §11) at `start`:
 * an optional `+` or `-`, then a decimal number (`123`, `1.5`, `.5`, `5.`, with an optional
 * exponent) or `&H` and hex digits. Returns null when no number starts there; otherwise the
 * longest match.
 */
export function scanNumeric(s: string, start: number): ScannedNumber | null {
  let i = start
  const negative = s[i] === '-'
  if (s[i] === '+' || s[i] === '-') i++

  if (s[i] === '&' && (s[i + 1] === 'H' || s[i + 1] === 'h')) {
    const digitsStart = i + 2
    let j = digitsStart
    while (isHexDigit(s[j])) j++
    if (j === digitsStart) return null
    const magnitude = BigInt(`0x${s.slice(digitsStart, j)}`)
    const outOfRange = magnitude > BigInt(MAX_SAFE)
    const value = Number(magnitude)
    return { value: negative ? -value : value, end: j, outOfRange }
  }

  const numberStart = i
  let sawDigit = false
  while (isDigit(s[i])) {
    i++
    sawDigit = true
  }
  if (s[i] === '.') {
    i++
    while (isDigit(s[i])) {
      i++
      sawDigit = true
    }
  }
  if (!sawDigit) return null
  if (s[i] === 'E' || s[i] === 'e') {
    let j = i + 1
    if (s[j] === '+' || s[j] === '-') j++
    if (isDigit(s[j])) {
      while (isDigit(s[j])) j++
      i = j
    }
  }
  const value = Number(s.slice(numberStart, i))
  return { value: negative ? -value : value, end: i, outOfRange: !Number.isFinite(value) }
}

/** True when the whole of `s` is one number in the shared grammar, with nothing around it. */
export function parseCompleteNumeric(s: string): ScannedNumber | null {
  const found = scanNumeric(s, 0)
  return found !== null && found.end === s.length ? found : null
}

/**
 * VAL(s) (Doc 01 §12): the longest prefix of `s`, after leading spaces, that matches the numeric
 * grammar; 0 if none. A space ends the number. An out-of-range result raises ?OV.
 */
export function val(s: string): number {
  let i = 0
  while (s[i] === ' ') i++
  const found = scanNumeric(s, i)
  if (found === null) return 0
  if (found.outOfRange) fault('OV', `VAL("${s}") is out of range`)
  return found.value
}
