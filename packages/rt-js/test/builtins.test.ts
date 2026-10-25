import { describe, expect, test } from 'vitest'
import {
  abs,
  asc,
  atn,
  chr,
  cos,
  exp,
  fix,
  formatNumber,
  instr,
  int,
  lcase,
  left,
  len,
  log,
  max,
  mid,
  min,
  right,
  sgn,
  sin,
  space,
  sqr,
  str,
  string,
  tan,
  trim,
  ucase,
} from '../src/index.ts'
import { faultCode } from './helpers.ts'

describe('numeric built-ins (Doc 01 §12)', () => {
  test('ABS', () => {
    expect(abs(-3)).toBe(3)
    expect(abs(2.5)).toBe(2.5)
  })

  test('SGN gives -1, 0 or 1, and SGN(-0) is 0', () => {
    expect(sgn(-2)).toBe(-1)
    expect(sgn(0.5)).toBe(1)
    expect(sgn(0)).toBe(0)
    expect(Object.is(sgn(-0), 0)).toBe(true)
  })

  test('INT floors and FIX truncates', () => {
    expect(int(-2.5)).toBe(-3)
    expect(int(2.5)).toBe(2)
    expect(fix(-2.5)).toBe(-2)
    expect(fix(2.9)).toBe(2)
  })

  test('SQR refuses a negative argument', () => {
    expect(sqr(9)).toBe(3)
    expect(faultCode(() => sqr(-1))).toBe('FC')
  })

  test('the trigonometric functions work in radians', () => {
    expect(sin(0)).toBe(0)
    expect(cos(0)).toBe(1)
    expect(tan(0)).toBe(0)
    expect(formatNumber(atn(1))).toBe('0.785398163397448')
  })

  test('EXP overflow raises ?OV', () => {
    expect(exp(0)).toBe(1)
    expect(faultCode(() => exp(1000))).toBe('OV')
  })

  test('LOG refuses zero and negative arguments', () => {
    expect(log(1)).toBe(0)
    expect(faultCode(() => log(0))).toBe('FC')
    expect(faultCode(() => log(-1))).toBe('FC')
  })

  test('MIN and MAX take two or more numbers, and the first wins a tie', () => {
    expect(min(3, 1, 2)).toBe(1)
    expect(max(3, 1, 2)).toBe(3)
    expect(Object.is(min(-0, 0), -0)).toBe(true)
    expect(Object.is(max(0, -0), 0)).toBe(true)
  })

  test('every numeric built-in refuses NaN and infinities with ?FC', () => {
    expect(faultCode(() => abs(NaN))).toBe('FC')
    expect(faultCode(() => int(Infinity))).toBe('FC')
    expect(faultCode(() => sin(-Infinity))).toBe('FC')
    expect(faultCode(() => min(1, NaN))).toBe('FC')
    expect(faultCode(() => left('A', NaN))).toBe('FC')
  })

  test('STR$ formats any number, including INF and NAN, without checking', () => {
    expect(str(3)).toBe('3')
    expect(str(-0.5)).toBe('-0.5')
    expect(str(Infinity)).toBe('INF')
    expect(str(NaN)).toBe('NAN')
  })
})

describe('string built-ins count code points (Doc 01 §12)', () => {
  test('LEN', () => {
    expect(len('HELLO')).toBe(5)
    expect(len('😀')).toBe(1)
    expect(len('')).toBe(0)
  })

  test('LEFT$', () => {
    expect(left('HELLO', 2)).toBe('HE')
    expect(left('HI', 5)).toBe('HI')
    expect(left('HELLO', 0)).toBe('')
    expect(left('HELLO', 2.9)).toBe('HE')
    expect(left('😀X', 1)).toBe('😀')
    expect(faultCode(() => left('A', -1))).toBe('FC')
  })

  test('RIGHT$', () => {
    expect(right('HELLO', 3)).toBe('LLO')
    expect(right('HI', 5)).toBe('HI')
    expect(right('X😀', 1)).toBe('😀')
    expect(faultCode(() => right('A', -1))).toBe('FC')
  })

  test('MID$', () => {
    expect(mid('HELLO', 2, 3)).toBe('ELL')
    expect(mid('HELLO', 2)).toBe('ELLO')
    expect(mid('HELLO', 5)).toBe('O')
    expect(mid('HELLO', 6)).toBe('')
    expect(mid('HELLO', 9)).toBe('')
    expect(mid('HELLO', 2, 0)).toBe('')
    expect(mid('HELLO', 2, 100)).toBe('ELLO')
    expect(mid('A😀B', 2, 1)).toBe('😀')
    expect(faultCode(() => mid('HELLO', 0))).toBe('FC')
    expect(faultCode(() => mid('HELLO', 2, -1))).toBe('FC')
  })

  test('INSTR', () => {
    expect(instr(1, 'HELLO', 'L')).toBe(3)
    expect(instr(4, 'HELLO', 'L')).toBe(4)
    expect(instr(5, 'HELLO', 'L')).toBe(0)
    expect(instr(1, 'HELLO', 'Z')).toBe(0)
    expect(instr(1, '😀A', 'A')).toBe(2)
    expect(faultCode(() => instr(0, 'ABC', 'A'))).toBe('FC')
  })

  test('INSTR with an empty needle gives start while start is within the string', () => {
    expect(instr(1, 'ABC', '')).toBe(1)
    expect(instr(3, 'ABC', '')).toBe(3)
    expect(instr(4, 'ABC', '')).toBe(0)
    expect(instr(1, '', '')).toBe(0)
  })

  test('CHR$', () => {
    expect(chr(65)).toBe('A')
    expect(chr(65.9)).toBe('A')
    expect(chr(128512)).toBe('😀')
    expect(chr(0)).toBe('\u0000')
    expect(faultCode(() => chr(-1))).toBe('FC')
    expect(faultCode(() => chr(1114112))).toBe('FC')
    expect(faultCode(() => chr(55296))).toBe('FC')
    expect(faultCode(() => chr(57343))).toBe('FC')
  })

  test('ASC', () => {
    expect(asc('A')).toBe(65)
    expect(asc('😀X')).toBe(128512)
    expect(faultCode(() => asc(''))).toBe('FC')
  })

  test('UCASE$ and LCASE$ use the locale-independent Unicode mapping', () => {
    expect(ucase('ß')).toBe('SS')
    expect(ucase('abc')).toBe('ABC')
    expect(lcase('ÀB')).toBe('àb')
  })

  test('TRIM$ removes only U+0020 spaces', () => {
    expect(trim('  a b  ')).toBe('a b')
    expect(trim('\ta\t')).toBe('\ta\t')
  })

  test('STRING$ repeats the first character of a string, or a code point', () => {
    expect(string(3, 'AB')).toBe('AAA')
    expect(string(3, 66)).toBe('BBB')
    expect(string(2, '😀')).toBe('😀😀')
    expect(string(0, 'A')).toBe('')
    expect(string(2.9, 'A')).toBe('AA')
    expect(faultCode(() => string(-1, 'A'))).toBe('FC')
    expect(faultCode(() => string(2, ''))).toBe('FC')
    expect(faultCode(() => string(2, 55296))).toBe('FC')
  })

  test('SPACE$', () => {
    expect(space(3)).toBe('   ')
    expect(space(0)).toBe('')
    expect(faultCode(() => space(-1))).toBe('FC')
  })

  test('STRING$ and SPACE$ refuse more than 16,777,216 characters with ?OM', () => {
    expect(faultCode(() => string(16777217, 'A'))).toBe('OM')
    expect(faultCode(() => space(16777217))).toBe('OM')
  })
})
