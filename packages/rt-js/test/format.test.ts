import { describe, expect, test } from 'vitest'
import { formatNumber } from '../src/index.ts'

describe('formatNumber: the Doc 01 §6 test vectors', () => {
  const infinity = 1e308 * 10
  test.each([
    [0, '0'],
    [-0, '0'],
    [3, '3'],
    [-3, '-3'],
    [0.5, '0.5'],
    [0.1 + 0.2, '0.3'],
    [1 / 3, '0.333333333333333'],
    [2 / 3, '0.666666666666667'],
    [-2.5, '-2.5'],
    [1234567.1234567, '1234567.1234567'],
    [1.4142135623730951, '1.4142135623731'],
    [1 + 2 ** -15, '1.00003051757813'],
    [1e15, '1000000000000000'],
    [2 ** 53, '9007199254740992'],
    [1e16, '1E+16'],
    [Number('12345678901234567890'), '1.23456789012346E+19'],
    [0.00001, '0.00001'],
    [1e-7, '0.0000001'],
    [1.5e-8, '1.5E-08'],
    [1.7976931348623157e308, '1.79769313486232E+308'],
    [5e-324, '4.94065645841247E-324'],
    [infinity, 'INF'],
    [-infinity, '-INF'],
    [infinity - infinity, 'NAN'],
  ])('%s prints as %s', (value, text) => {
    expect(formatNumber(value)).toBe(text)
  })
})

describe('formatNumber: consequences of the §6 rules', () => {
  test('a fraction that rounds to 15 digits can print as a whole number in fixed notation', () => {
    expect(formatNumber(123456789012345.6)).toBe('123456789012346')
  })

  test('a non-integer with exponent 15 prints in scientific notation', () => {
    expect(formatNumber(1e15 + 0.5)).toBe('1E+15')
  })

  test('scientific notation keeps two exponent digits and an explicit sign', () => {
    expect(formatNumber(1e21)).toBe('1E+21')
    expect(formatNumber(-1.25e-10)).toBe('-1.25E-10')
  })

  test('small fixed-notation values keep their leading zeros', () => {
    expect(formatNumber(-1e-7)).toBe('-0.0000001')
    expect(formatNumber(0.000123)).toBe('0.000123')
  })

  test('whole numbers keep their trailing zeros', () => {
    expect(formatNumber(100)).toBe('100')
    expect(formatNumber(-1200)).toBe('-1200')
  })
})
