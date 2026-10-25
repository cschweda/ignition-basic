/**
 * The decimal digits PRINT shows for a positive, finite number (Doc 01 §6): the value is
 * `d.ddd… × 10^exponent`, where `digits` holds d, d, d….
 *
 * Whole numbers below 10^16 keep every digit, trailing zeros included. Anything else is rounded
 * to 15 significant digits, ties away from zero on the exact binary value (which is what
 * `toExponential(14)` does), and loses its trailing zeros.
 */
export function shownDigits(abs: number): { digits: string; exponent: number } {
  if (Number.isInteger(abs) && abs < 1e16) {
    const digits = BigInt(abs).toString()
    return { digits, exponent: digits.length - 1 }
  }
  const [mantissa = '', exp = '0'] = abs.toExponential(14).split('e')
  const digits = mantissa.replace('.', '').replace(/0+$/, '')
  return { digits, exponent: Number(exp) }
}

/** Formats a number the way PRINT and STR$ show it (Doc 01 §6). */
export function formatNumber(x: number): string {
  if (Number.isNaN(x)) return 'NAN'
  if (x === Infinity) return 'INF'
  if (x === -Infinity) return '-INF'
  if (x === 0) return '0'

  const sign = x < 0 ? '-' : ''
  const abs = Math.abs(x)
  const { digits, exponent } = shownDigits(abs)
  if (Number.isInteger(abs) && abs < 1e16) return sign + digits

  if (exponent >= -7 && exponent < 15) {
    if (exponent < 0) return `${sign}0.${'0'.repeat(-exponent - 1)}${digits}`
    const whole = digits.slice(0, exponent + 1).padEnd(exponent + 1, '0')
    const fraction = digits.slice(exponent + 1)
    return sign + (fraction === '' ? whole : `${whole}.${fraction}`)
  }

  const mantissa = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits
  const expSign = exponent < 0 ? '-' : '+'
  return `${sign}${mantissa}E${expSign}${String(Math.abs(exponent)).padStart(2, '0')}`
}
