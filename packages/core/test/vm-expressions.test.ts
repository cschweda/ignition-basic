import { describe, expect, test } from 'vitest'
import { output, run } from './vm-helpers.ts'

describe('running a program', () => {
  test('PRINT and END', () => {
    const r = run('10 PRINT "HI"\n20 END\n30 PRINT "NOT REACHED"')
    expect(r.output()).toBe('HI\n')
    expect(r.status).toBe('ended')
  })

  test('running off the last line ends the program', () => {
    const r = run('10 PRINT 1')
    expect(r.output()).toBe('1\n')
    expect(r.status).toBe('ended')
  })

  test('an empty program ends at once', () => {
    expect(run('').status).toBe('ended')
  })
})

describe('expressions (Doc 01 §5)', () => {
  test('^ is right-associative and binds tighter than a unary minus on its left', () => {
    expect(output('10 PRINT -2 ^ 2; " "; 2 ^ -1; " "; 2 ^ 3 ^ 2; " "; 0 ^ 0')).toBe(
      '-4 0.5 512 1\n',
    )
  })

  test('\\ and MOD share a level with * and /', () => {
    expect(output('10 PRINT 7 \\ 2 * 3; " "; -7 \\ 2; " "; -7 MOD 2; " "; 7 MOD -2')).toBe(
      '9 -3 -1 1\n',
    )
  })

  test('precedence and parentheses', () => {
    expect(output('10 PRINT 1 + 2 * 3; " "; (1 + 2) * 3; " "; 10 - 4 - 3')).toBe('7 9 3\n')
  })

  test('+ joins strings', () => {
    expect(output('10 A$ = "AB": PRINT A$ + "CD"')).toBe('ABCD\n')
  })

  test('division by zero raises ?/0', () => {
    const r = run('10 PRINT 1 / 0')
    expect(r.output()).toBe('?/0 ERROR IN 10\n')
    expect(r.status).toBe('error')
  })

  test('+ - * ^ follow IEEE, so overflow prints INF, -INF and NAN', () => {
    expect(output('10 X = 1E308 * 10: PRINT X; " "; -X; " "; X - X')).toBe('INF -INF NAN\n')
  })

  test('AND and OR short-circuit, so the right operand may never run', () => {
    const src = `10 DIM A(10): I = 11
20 IF I <= 10 AND A(I) > 0 THEN PRINT "NO" ELSE PRINT "SAFE"
30 IF I > 10 OR A(I) > 0 THEN PRINT "SAFE"`
    expect(output(src)).toBe('SAFE\nSAFE\n')
  })

  test('NOT', () => {
    expect(output('10 IF NOT 1 > 2 THEN PRINT "YES"')).toBe('YES\n')
  })

  test('strings compare by code point, case-sensitively', () => {
    expect(output('10 IF "a" > "B" THEN PRINT "A"\n20 IF "APPLE" < "APPLES" THEN PRINT "B"')).toBe(
      'A\nB\n',
    )
    expect(output('10 IF "😀" > "￿" THEN PRINT "C"')).toBe('C\n')
  })

  test('evaluation is left to right, which RND makes visible', () => {
    const src = `10 X = RND(1): Y = RND(1)
20 RANDOMIZE 0
30 IF RND(1) - RND(1) = X - Y THEN PRINT "LEFT TO RIGHT"`
    expect(output(src)).toBe('LEFT TO RIGHT\n')
  })

  test('built-in functions are called through the runtime', () => {
    expect(output('10 PRINT LEN("HELLO"); " "; LEFT$("HELLO", 2); " "; INSTR("HELLO", "L")')).toBe(
      '5 HE 3\n',
    )
    expect(output('10 PRINT ROUND(2.5); " "; MAX(1, 7, 3); " "; INT(-2.5); " "; STR$(1 / 3)')).toBe(
      '3 7 -3 0.333333333333333\n',
    )
  })

  test('an error inside a built-in stops the program with its code', () => {
    expect(output('10 PRINT SQR(-1)')).toBe('?FC ERROR IN 10\n')
  })
})

describe('variables (Doc 01 §4)', () => {
  test('start as 0 or ""', () => {
    expect(output('10 PRINT A; "["; A$; "]"; B%')).toBe('0[]0\n')
  })

  test('A, A% and A$ are different; A# and A! are A', () => {
    expect(output('10 A = 1: A% = 2: A$ = "S": A# = 5\n20 PRINT A; A%; A$; A!')).toBe('52S5\n')
  })

  test('% truncates toward zero on assignment', () => {
    expect(output('10 A% = 3.9: B% = -3.9: PRINT A%; " "; B%')).toBe('3 -3\n')
  })

  test('% out of range raises ?OV', () => {
    expect(output('10 A% = 1E16')).toBe('?OV ERROR IN 10\n')
  })

  test('names are case-insensitive', () => {
    expect(output('10 total = 2: PRINT TOTAL + Total')).toBe('4\n')
  })
})
