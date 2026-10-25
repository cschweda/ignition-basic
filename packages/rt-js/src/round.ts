import { fault } from './errors.ts'
import { shownDigits } from './format.ts'
import { checkFinite } from './checks.ts'

/**
 * ROUND(x [, n]) (Doc 01 §12): rounds the decimal value PRINT shows for `x` to `n` decimal places,
 * ties away from zero. A negative `n` rounds to tens, hundreds and so on.
 *
 * Working on the shown digits rather than the binary value is what makes `ROUND(1.005, 2)` give
 * 1.01 (1.005 is stored as 1.00499999…, but PRINT shows 1.005).
 */
export function round(x: number, n = 0): number {
  checkFinite('ROUND', x)
  checkFinite('ROUND', n)
  const places = Math.trunc(n)
  if (places < -15 || places > 15) fault('FC', `ROUND to ${places} places; the range is -15 to 15`)
  if (x === 0) return x

  const sign = x < 0 ? '-' : ''
  const { digits, exponent } = shownDigits(Math.abs(x))
  // The shown value is the integer `digits` times 10^scale.
  const scale = exponent - (digits.length - 1)

  let kept: bigint
  if (scale >= -places) {
    kept = BigInt(digits) * 10n ** BigInt(scale + places)
  } else {
    const keep = digits.length - (-places - scale)
    kept = keep > 0 ? BigInt(digits.slice(0, keep)) : 0n
    const nextDigit = keep >= 0 && keep < digits.length ? Number(digits[keep]) : 0
    if (nextDigit >= 5) kept += 1n
  }

  // `kept` counts units of 10^-places.
  let text = kept.toString()
  if (places > 0) {
    text = text.padStart(places + 1, '0')
    text = `${text.slice(0, -places)}.${text.slice(-places)}`
  } else if (places < 0) {
    text += '0'.repeat(-places)
  }
  // With |places| <= 15 rounding only happens below 10^30, so the result is always finite.
  return Number(sign + text)
}
