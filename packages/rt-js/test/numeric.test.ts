import { describe, expect, test } from 'vitest'
import { scanNumeric, val } from '../src/index.ts'
import { faultCode } from './helpers.ts'

describe('the numeric grammar shared by DATA, INPUT and VAL (Doc 01 §11)', () => {
  test.each([
    ['123', 123, 3],
    ['1.5', 1.5, 3],
    ['.5', 0.5, 2],
    ['5.', 5, 2],
    ['1E10', 1e10, 4],
    ['2.5e-3', 0.0025, 6],
    ['&HFF', 255, 4],
    ['&hff', 255, 4],
    ['+5', 5, 2],
    ['-5', -5, 2],
    ['-&H10', -16, 5],
    ['12AB', 12, 2],
    ['1e5x', 1e5, 3],
    ['1E+', 1, 1],
  ])('%j scans as %s, ending at %s', (text, value, end) => {
    expect(scanNumeric(text, 0)).toEqual({ value, end, outOfRange: false })
  })

  test.each([[''], ['.'], ['&H'], ['&HG'], ['- 5'], ['abc'], ['e5'], ['+']])(
    '%j does not start a number',
    (text) => {
      expect(scanNumeric(text, 0)).toBeNull()
    },
  )

  test('scanning can start in the middle of a string', () => {
    expect(scanNumeric('A=42;', 2)).toEqual({ value: 42, end: 4, outOfRange: false })
  })

  test('a decimal that is not finite is out of range', () => {
    expect(scanNumeric('1E400', 0)?.outOfRange).toBe(true)
  })

  test('hex above 2^53 - 1 is out of range', () => {
    expect(scanNumeric('&H1FFFFFFFFFFFFF', 0)).toEqual({
      value: 9007199254740991,
      end: 16,
      outOfRange: false,
    })
    expect(scanNumeric('&H20000000000000', 0)?.outOfRange).toBe(true)
  })
})

describe('VAL (Doc 01 §12)', () => {
  test.each([
    ['123', 123],
    ['1 2', 1],
    ['  -3.5abc', -3.5],
    ['&HFF', 255],
    ['1E', 1],
    ['abc', 0],
    ['', 0],
    ['.', 0],
    ['\t5', 0],
  ])('VAL(%j) is %s', (text, want) => {
    expect(val(text)).toBe(want)
  })

  test('an infinite result raises ?OV', () => {
    expect(faultCode(() => val('1E400'))).toBe('OV')
  })

  test('hex above 2^53 - 1 raises ?OV, as it does in a literal', () => {
    expect(faultCode(() => val('&H20000000000000'))).toBe('OV')
  })
})
