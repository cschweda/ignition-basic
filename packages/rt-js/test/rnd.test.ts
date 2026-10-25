import { describe, expect, test } from 'vitest'
import { createGenerator, formatNumber, nextFloat, randomize, rnd } from '../src/index.ts'
import { faultCode } from './helpers.ts'

describe('the generator: Doc 01 §13 test vectors', () => {
  test('seed(0) leaves the published first SplitMix64 output in s0', () => {
    const g = createGenerator()
    expect(g.s0).toBe(0xe220a8397b1dcdafn)
    expect(g.s1).toBe(0x6e789e6aa1b965f4n)
  })

  test('the first five RND(1) of an unseeded program', () => {
    const g = createGenerator()
    const raw = [
      2835815852120806, 72414381107965, 3367929637533554, 4134135027186406, 2233321285806917,
    ]
    const shown = [
      '0.314838805262153',
      '0.00803961132200437',
      '0.373915302890721',
      '0.45898118940917',
      '0.24794847128883',
    ]
    for (let i = 0; i < 5; i++) {
      const u = rnd(g, 1)
      expect(u).toBe(raw[i]! * 2 ** -53)
      expect(formatNumber(u)).toBe(shown[i])
    }
  })

  test('RANDOMIZE 42, then ten RND(6)', () => {
    const g = createGenerator()
    randomize(g, 42)
    const rolls = Array.from({ length: 10 }, () => rnd(g, 6))
    expect(rolls).toEqual([6, 5, 5, 6, 6, 1, 3, 6, 5, 1])
  })

  test('RANDOMIZE -1, then three RND(1)', () => {
    const g = createGenerator()
    randomize(g, -1)
    const shown = Array.from({ length: 3 }, () => formatNumber(rnd(g, 1)))
    expect(shown).toEqual(['0.806540123877638', '0.6060760004281', '0.125025527383241'])
  })

  test('RANDOMIZE 7, then RND(100), is the worked example secret number', () => {
    const g = createGenerator()
    randomize(g, 7)
    expect(rnd(g, 100)).toBe(41)
  })
})

describe('RND(x) cases (Doc 01 §13)', () => {
  test('x between 0 and 1 draws a fraction, just like RND(1)', () => {
    const a = createGenerator()
    const b = createGenerator()
    expect(rnd(a, 0.5)).toBe(rnd(b, 1))
  })

  test('RND(0) repeats the last value drawn', () => {
    const g = createGenerator()
    const u = rnd(g, 1)
    expect(rnd(g, 0)).toBe(u)
    expect(rnd(g, 0)).toBe(u)
  })

  test('after a whole-number RND, RND(0) gives the fraction behind it', () => {
    const g = createGenerator()
    const reference = createGenerator()
    rnd(g, 6)
    expect(rnd(g, 0)).toBe(nextFloat(reference))
  })

  test('RND(0) with nothing drawn yet behaves like RND(1) and draws', () => {
    const g = createGenerator()
    const reference = createGenerator()
    expect(rnd(g, 0)).toBe(rnd(reference, 1))
    expect(rnd(g, 1)).toBe(rnd(reference, 1))
  })

  test('seeding forgets the last value', () => {
    const g = createGenerator()
    rnd(g, 1)
    randomize(g, 3)
    const reference = createGenerator()
    randomize(reference, 3)
    expect(rnd(g, 0)).toBe(rnd(reference, 1))
  })

  test('x above 1 truncates to m and returns a whole number from 1 to m', () => {
    const g = createGenerator()
    expect(rnd(g, 1.5)).toBe(1)
    const big = createGenerator()
    const n = rnd(big, 6.9)
    expect(Number.isInteger(n) && n >= 1 && n <= 6).toBe(true)
  })

  test('a negative, NaN or infinite x raises ?FC', () => {
    const g = createGenerator()
    expect(faultCode(() => rnd(g, -1))).toBe('FC')
    expect(faultCode(() => rnd(g, NaN))).toBe('FC')
    expect(faultCode(() => rnd(g, Infinity))).toBe('FC')
  })

  test('x above 2^53 - 1 raises ?FC', () => {
    const g = createGenerator()
    expect(faultCode(() => rnd(g, 2 ** 53))).toBe('FC')
    expect(faultCode(() => rnd(g, 2 ** 53 - 1))).toBeUndefined()
  })
})

describe('RANDOMIZE n (Doc 01 §13)', () => {
  test('seeds with FIX(n)', () => {
    const a = createGenerator()
    const b = createGenerator()
    randomize(a, 2.7)
    randomize(b, 2)
    expect(rnd(a, 1)).toBe(rnd(b, 1))
    const c = createGenerator()
    const d = createGenerator()
    randomize(c, -2.7)
    randomize(d, -2)
    expect(rnd(c, 1)).toBe(rnd(d, 1))
  })

  test('a non-finite n, or |FIX(n)| above 2^53 - 1, raises ?FC', () => {
    const g = createGenerator()
    expect(faultCode(() => randomize(g, NaN))).toBe('FC')
    expect(faultCode(() => randomize(g, -Infinity))).toBe('FC')
    expect(faultCode(() => randomize(g, 2 ** 53))).toBe('FC')
    expect(faultCode(() => randomize(g, -(2 ** 53 - 1)))).toBeUndefined()
  })
})
