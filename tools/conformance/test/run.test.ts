import { describe, expect, test } from 'vitest'
import { runCase } from '../src/run.ts'

describe('runCase (Doc 01 §18)', () => {
  test('captures the console as a transcript', () => {
    const result = runCase('10 PRINT "HI"', [])
    expect(result).toEqual({ output: 'HI\n', failure: null })
  })

  test('feeds scripted input, one line per request, echoed by the VM', () => {
    expect(runCase('10 INPUT "N"; N\n20 PRINT N * 2', ['21']).output).toBe('N? 21\n42\n')
  })

  test('writes CLS as a [CLS] line, starting a new line if needed', () => {
    expect(runCase('10 PRINT "A";: CLS: PRINT "B"', []).output).toBe('A\n[CLS]\nB\n')
    expect(runCase('10 CLS: PRINT "B"', []).output).toBe('[CLS]\nB\n')
  })

  test('adds a final line break when the output does not end with one', () => {
    expect(runCase('10 PRINT "A";', []).output).toBe('A\n')
  })

  test('a runtime error is part of the transcript, not a failure', () => {
    expect(runCase('10 PRINT 1 / 0', [])).toEqual({ output: '?/0 ERROR IN 10\n', failure: null })
  })

  test('uses the virtual clock: each TIMER read advances 0.001 s', () => {
    expect(runCase('10 PRINT TIMER: PRINT TIMER', []).output).toBe('0.001\n0.002\n')
  })

  test('uses entropy 0, so a bare RANDOMIZE is RANDOMIZE 0', () => {
    expect(runCase('10 RANDOMIZE: PRINT RND(1)', []).output).toBe('0.314838805262153\n')
  })

  test('fails a case that asks for more input than it was given', () => {
    expect(runCase('10 INPUT A: INPUT B', ['1']).failure).toMatch(/more input/)
  })

  test('fails a case that leaves input lines unused', () => {
    expect(runCase('10 INPUT A', ['1', '2']).failure).toMatch(/1 input line.* unused/)
  })

  test('fails a case that runs more statements than the limit', () => {
    expect(runCase('10 GOTO 10', [], { statementLimit: 1000 }).failure).toMatch(/1,000 statements/)
  })

  test('fails a program that does not compile', () => {
    expect(runCase('10 PRINT "A" + 1', []).failure).toMatch(/TM/)
  })
})
