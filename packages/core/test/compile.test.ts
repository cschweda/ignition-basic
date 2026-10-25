import { describe, expect, test } from 'vitest'
import { compile } from '../src/compile.ts'

describe('compile (Doc 01 §16)', () => {
  test('returns a runnable program and the Index when there are no errors', () => {
    const result = compile('10 PRINT "HI"')
    expect(result.errors).toEqual([])
    expect(result.program?.dialect).toBe('ignition')
    expect(result.program?.instrs.map((i) => i.op)).toEqual(['print'])
    expect(result.index.lines).toEqual([10])
  })

  test('any compile error means no program, but the Index is still there', () => {
    const result = compile('10 PRINT "A" + 1\n20 GOTO 99')
    expect(result.program).toBeNull()
    expect(result.errors.map((e) => `${e.code}@${e.lineno}`)).toEqual(['TM@10', 'UL@20'])
    expect(result.index.lines).toEqual([10, 20])
  })

  test('parse errors and semantic errors come back together, in source order', () => {
    const result = compile('10 X = "A" * 2\n20 PRINT +\n30 GOTO 99')
    expect(result.errors.map((e) => `${e.code}@${e.lineno}`)).toEqual(['TM@10', 'SN@20', 'UL@30'])
  })

  test('a FOR or NEXT on a line the parser rejected is not reported a second time', () => {
    const result = compile('10 FOR I = 1 TO 2\n20 PRINT +: NEXT I')
    expect(result.errors.map((e) => `${e.code}@${e.lineno}`)).toEqual(['SN@20'])
  })

  test('warnings do not stop a program from running', () => {
    const result = compile('10 A(1) = 2')
    expect(result.program).not.toBeNull()
    expect(result.index.warnings.map((w) => w.code)).toEqual(['IMPLICIT_DIM'])
  })

  test("accepts the 'ignition' dialect, the only one Phase 1 has", () => {
    expect(compile('10 END', { dialect: 'ignition' }).program).not.toBeNull()
  })

  test('any other dialect is a host bug and throws', () => {
    expect(() => compile('10 END', { dialect: 'trs80' as 'ignition' })).toThrow(/dialect/)
  })
})
