import { describe, expect, test } from 'vitest'
import { output } from './vm-helpers.ts'

describe('arrays (Doc 01 §10)', () => {
  test('DIM creates arrays whose elements start at 0 or ""', () => {
    expect(output('10 DIM A(2), B$(1, 1)\n20 PRINT A(2); "["; B$(1, 1); "]"')).toBe('0[]\n')
  })

  test('two dimensions are distinct elements', () => {
    expect(
      output('10 DIM G(1, 2)\n20 G(1, 0) = 5: G(0, 2) = 7\n30 PRINT G(1, 0); G(0, 2); G(0, 0)'),
    ).toBe('570\n')
  })

  test('an array used without DIM gets bounds 0 to 10', () => {
    expect(output('10 A(10) = 5: PRINT A(10)')).toBe('5\n')
    expect(output('10 A(11) = 5')).toBe('?BS ERROR IN 10\n')
    expect(output('10 A$(3) = "X": PRINT A$(3); A$(2); "!"')).toBe('X!\n')
  })

  test('subscripts are truncated; negative or non-finite ones raise ?BS', () => {
    expect(output('10 DIM A(3)\n20 A(2.9) = 7: PRINT A(2)')).toBe('7\n')
    expect(output('10 DIM A(3)\n20 PRINT A(-1)')).toBe('?BS ERROR IN 20\n')
    expect(output('10 DIM A(3)\n20 PRINT A(1E308 * 10)')).toBe('?BS ERROR IN 20\n')
  })

  test('DIM bounds are truncated when the DIM runs', () => {
    expect(output('10 N = 2.9: DIM A(N)\n20 A(2) = 1: A(3) = 1')).toBe('?BS ERROR IN 20\n')
  })

  test('DIM of an existing array raises ?DD, whether it was DIMed or used', () => {
    expect(output('10 DIM A(5)\n20 DIM A(5)')).toBe('?DD ERROR IN 20\n')
    expect(output('10 A(1) = 1\n20 DIM A(5)')).toBe('?DD ERROR IN 20\n')
  })

  test('a negative bound raises ?FC, and too many elements ?OM', () => {
    expect(output('10 DIM A(-1)')).toBe('?FC ERROR IN 10\n')
    expect(output('10 DIM A(4096, 4096)')).toBe('?OM ERROR IN 10\n')
  })

  test('% arrays follow the % storage rule', () => {
    expect(output('10 DIM A%(1)\n20 A%(0) = 2.7: PRINT A%(0)')).toBe('2\n')
  })
})

describe('DATA, READ and RESTORE (Doc 01 §11)', () => {
  test('READ takes items in order, numbers and strings', () => {
    expect(output('10 READ A, B$, C\n20 PRINT A; B$; C\n30 DATA 1, HELLO, -2.5')).toBe(
      '1HELLO-2.5\n',
    )
  })

  test('READ never converts: a mismatch raises ?TM', () => {
    expect(output('10 READ A\n20 DATA X')).toBe('?TM ERROR IN 10\n')
    expect(output('10 READ A\n20 DATA "5"')).toBe('?TM ERROR IN 10\n')
    expect(output('10 READ A$\n20 DATA 5')).toBe('?TM ERROR IN 10\n')
  })

  test('reading past the last item raises ?OD', () => {
    expect(output('10 READ A, B\n20 DATA 1')).toBe('?OD ERROR IN 10\n')
  })

  test('an empty item is the empty string', () => {
    expect(output('10 READ A$\n20 PRINT "["; A$; "]"\n30 DATA ,X')).toBe('[]\n')
  })

  test('RESTORE goes back to the first item; RESTORE n to line n', () => {
    expect(output('10 READ A: RESTORE: READ B\n20 PRINT A; B\n30 DATA 7, 8')).toBe('77\n')
    expect(output('10 RESTORE 30: READ A: PRINT A\n20 DATA 1\n30 DATA 2')).toBe('2\n')
  })

  test('RESTORE n with no DATA at or after n leaves nothing to read', () => {
    expect(output('10 RESTORE 30: READ A\n20 DATA 1\n30 END')).toBe('?OD ERROR IN 10\n')
  })

  test('each target takes its item before the next target is evaluated', () => {
    expect(output('10 READ I, A(I)\n20 PRINT A(2)\n30 DATA 2, 9')).toBe('9\n')
  })
})

describe('the MID$ statement (Doc 01 §12)', () => {
  test('overwrites a variable in place', () => {
    expect(output('10 A$ = "HELLO": MID$(A$, 2, 3) = "ipp": PRINT A$')).toBe('HippO\n')
  })

  test('works on an array element', () => {
    expect(output('10 A$(1) = "ABC": MID$(A$(1), 3) = "Z": PRINT A$(1)')).toBe('ABZ\n')
  })

  test('a start past the end raises ?FC', () => {
    expect(output('10 A$ = "ABC": MID$(A$, 5) = "X"')).toBe('?FC ERROR IN 10\n')
  })
})
