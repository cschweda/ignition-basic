import { describe, expect, test } from 'vitest'
import { convertInputField, splitInputLine, wholeLineField } from '../src/index.ts'

const plain = (text: string) => ({ text, quoted: false })
const quoted = (text: string) => ({ text, quoted: true })

describe('splitting an INPUT line into fields (Doc 01 §8, step 3)', () => {
  test('splits at commas and trims spaces from each field', () => {
    expect(splitInputLine('1, 2,3 ')).toEqual([plain('1'), plain('2'), plain('3')])
  })

  test('a field that starts with a quote runs to the next quote and can hold commas', () => {
    expect(splitInputLine('  "A, B" , C')).toEqual([quoted('A, B'), plain('C')])
    expect(splitInputLine(' "x" ')).toEqual([quoted('x')])
  })

  test('a quote that does not start a field is an ordinary character', () => {
    expect(splitInputLine('ab"c, d')).toEqual([plain('ab"c'), plain('d')])
  })

  test('empty fields are empty strings', () => {
    expect(splitInputLine('')).toEqual([plain('')])
    expect(splitInputLine('1,')).toEqual([plain('1'), plain('')])
    expect(splitInputLine('a,,b')).toEqual([plain('a'), plain(''), plain('b')])
  })

  test('anything but spaces between a closing quote and the next comma makes the line invalid', () => {
    expect(splitInputLine('"A"x, B')).toBeNull()
  })

  test('an unterminated quoted field makes the line invalid', () => {
    expect(splitInputLine('"A, B')).toBeNull()
  })
})

describe('a single string target takes the whole line (Doc 01 §8, step 3)', () => {
  test('trimmed of leading and trailing spaces, commas and quotes kept', () => {
    expect(wholeLineField('  HELLO, "WORLD"  ')).toBe('HELLO, "WORLD"')
  })
})

describe('converting a field for its target (Doc 01 §8, step 6)', () => {
  test('a numeric target takes a complete literal in the shared grammar', () => {
    expect(convertInputField(plain('42'), 'number')).toBe(42)
    expect(convertInputField(plain('&HFF'), 'number')).toBe(255)
    expect(convertInputField(plain('-1.5e2'), 'number')).toBe(-150)
    expect(convertInputField(plain('+.5'), 'number')).toBe(0.5)
  })

  test('anything else for a numeric target is invalid', () => {
    expect(convertInputField(plain('abc'), 'number')).toBeNull()
    expect(convertInputField(plain(''), 'number')).toBeNull()
    expect(convertInputField(plain('12abc'), 'number')).toBeNull()
    expect(convertInputField(plain('- 5'), 'number')).toBeNull()
  })

  test('a value that is not finite is invalid', () => {
    expect(convertInputField(plain('1E400'), 'number')).toBeNull()
    expect(convertInputField(plain('&H20000000000000'), 'number')).toBeNull()
  })

  test('a quoted field for a numeric target is invalid', () => {
    expect(convertInputField(quoted('5'), 'number')).toBeNull()
  })

  test('a % target also needs the value to fit ±(2^53 - 1) once truncated', () => {
    expect(convertInputField(plain('9007199254740991'), 'integer')).toBe(9007199254740991)
    expect(convertInputField(plain('-3.7'), 'integer')).toBe(-3.7)
    expect(convertInputField(plain('9007199254740992'), 'integer')).toBeNull()
    expect(convertInputField(plain('1E20'), 'integer')).toBeNull()
  })

  test('a string target takes the text, quoted or not', () => {
    expect(convertInputField(quoted(' HI '), 'string')).toBe(' HI ')
    expect(convertInputField(plain('HI'), 'string')).toBe('HI')
    expect(convertInputField(plain('123'), 'string')).toBe('123')
  })
})
