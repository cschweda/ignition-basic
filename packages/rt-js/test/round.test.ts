import { describe, expect, test } from 'vitest'
import { round } from '../src/index.ts'
import { faultCode } from './helpers.ts'

describe('ROUND: the Doc 01 §12 test vectors', () => {
  test.each([
    [2.5, 0, 3],
    [-2.5, 0, -3],
    [-0.5, 0, -1],
    [1.005, 2, 1.01],
    [2.675, 2, 2.68],
    [1 / 3, 4, 0.3333],
    [1234.5678, -2, 1200],
    [0.49999999999999994, 0, 1],
  ])('ROUND(%s, %s) is %s', (x, n, want) => {
    expect(round(x, n)).toBe(want)
  })
})

describe('ROUND: the rest of its definition', () => {
  test('n defaults to 0', () => {
    expect(round(2.5)).toBe(3)
  })

  test('a negative n rounds to tens, ties away from zero', () => {
    expect(round(15, -1)).toBe(20)
    expect(round(-15, -1)).toBe(-20)
    expect(round(14, -1)).toBe(10)
  })

  test('a value already at the requested precision comes back unchanged', () => {
    expect(round(5, 2)).toBe(5)
    expect(round(0.125, 3)).toBe(0.125)
  })

  test('rounding the shown value lets a 15-digit result replace float noise', () => {
    expect(round(0.1 + 0.2, 5)).toBe(0.3)
  })

  test('n is truncated toward zero', () => {
    expect(round(2.567, 1.9)).toBe(2.6)
    expect(round(2567, -1.9)).toBe(2570)
  })

  test('n outside -15..15 raises ?FC', () => {
    expect(faultCode(() => round(1, 16))).toBe('FC')
    expect(faultCode(() => round(1, -16))).toBe('FC')
    expect(faultCode(() => round(1, 15))).toBeUndefined()
  })

  test('a NaN or infinite argument raises ?FC', () => {
    expect(faultCode(() => round(NaN))).toBe('FC')
    expect(faultCode(() => round(Infinity))).toBe('FC')
    expect(faultCode(() => round(1, NaN))).toBe('FC')
  })

  test('a large value comes back as the 15-digit value PRINT shows', () => {
    expect(round(1.2345678901234567e300, -15)).toBe(1.23456789012346e300)
  })

  test('a result that rounds past the largest double raises ?OV (Doc 01 §12)', () => {
    // PRINT shows the largest double as 1.79769313486232E+308, which is beyond it.
    expect(faultCode(() => round(1.7976931348623157e308))).toBe('OV')
    expect(faultCode(() => round(-1.7976931348623157e308, -15))).toBe('OV')
  })
})
