import { describe, expect, test } from 'vitest'
import { compareStrings, divide, intDiv, midAssign, mod, toInteger } from '../src/index.ts'
import { faultCode } from './helpers.ts'

describe('/ (Doc 01 §5)', () => {
  test('is IEEE division', () => {
    expect(divide(7, 2)).toBe(3.5)
    expect(divide(1, 3)).toBe(1 / 3)
  })

  test('a divisor of 0 or -0 raises ?/0', () => {
    expect(faultCode(() => divide(1, 0))).toBe('/0')
    expect(faultCode(() => divide(1, -0))).toBe('/0')
  })
})

describe('\\ and MOD (Doc 01 §5)', () => {
  test('\\ truncates both operands, then the result', () => {
    expect(intDiv(7, 2)).toBe(3)
    expect(intDiv(-7, 2)).toBe(-3)
    expect(intDiv(7.9, 2.9)).toBe(3)
  })

  test('MOD works on truncated operands, with the sign of the dividend', () => {
    expect(mod(-7, 2)).toBe(-1)
    expect(mod(7, -2)).toBe(1)
    expect(mod(7.9, 2.9)).toBe(1)
  })

  test('a zero result is never -0', () => {
    expect(Object.is(intDiv(-1, 2), 0)).toBe(true)
    expect(Object.is(mod(-4, 2), 0)).toBe(true)
  })

  test('a truncated divisor of 0 raises ?/0', () => {
    expect(faultCode(() => intDiv(1, 0.5))).toBe('/0')
    expect(faultCode(() => mod(1, 0))).toBe('/0')
  })

  test('an operand that is not finite, or outside ±(2^53 - 1), raises ?OV', () => {
    expect(faultCode(() => intDiv(Infinity, 2))).toBe('OV')
    expect(faultCode(() => mod(2 ** 53, 2))).toBe('OV')
    expect(faultCode(() => intDiv(1, NaN))).toBe('OV')
    expect(faultCode(() => mod(2 ** 53 - 1, 2))).toBeUndefined()
  })
})

describe('the % storage rule (Doc 01 §4)', () => {
  test('truncates toward zero', () => {
    expect(toInteger(3.9)).toBe(3)
    expect(toInteger(-3.9)).toBe(-3)
  })

  test('never stores -0', () => {
    expect(Object.is(toInteger(-0.5), 0)).toBe(true)
  })

  test('a value that is not finite, or outside ±(2^53 - 1), raises ?OV', () => {
    expect(faultCode(() => toInteger(1e16))).toBe('OV')
    expect(faultCode(() => toInteger(-Infinity))).toBe('OV')
    expect(faultCode(() => toInteger(NaN))).toBe('OV')
    expect(toInteger(-(2 ** 53 - 1))).toBe(-(2 ** 53 - 1))
  })
})

describe('string comparison is by code point, case-sensitive (Doc 01 §5)', () => {
  test('orders as code points do', () => {
    expect(compareStrings('A', 'B')).toBeLessThan(0)
    expect(compareStrings('B', 'A')).toBeGreaterThan(0)
    expect(compareStrings('A', 'A')).toBe(0)
    expect(compareStrings('A', 'AB')).toBeLessThan(0)
    expect(compareStrings('a', 'B')).toBeGreaterThan(0)
  })

  test('a character beyond U+FFFF sorts after every BMP character, unlike UTF-16 order', () => {
    expect(compareStrings('😀', '￿')).toBeGreaterThan(0)
  })
})

describe('the MID$ statement (Doc 01 §12)', () => {
  test('overwrites in place without changing the length', () => {
    expect(midAssign('Hello, World', 8, undefined, 'Earth')).toBe('Hello, Earth')
    expect(midAssign('ABCDE', 2, 2, 'xyz')).toBe('AxyDE')
    expect(midAssign('ABCDE', 4, undefined, 'xyz')).toBe('ABCxy')
    expect(midAssign('ABCDE', 2, undefined, 'x')).toBe('AxCDE')
  })

  test('counts code points', () => {
    expect(midAssign('A😀C', 2, 1, 'B')).toBe('ABC')
  })

  test('a start below 1 or past the end, or a negative length, raises ?FC', () => {
    expect(faultCode(() => midAssign('ABC', 0, undefined, 'x'))).toBe('FC')
    expect(faultCode(() => midAssign('ABC', 4, undefined, 'x'))).toBe('FC')
    expect(faultCode(() => midAssign('ABC', 1, -1, 'x'))).toBe('FC')
  })
})
