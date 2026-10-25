import { describe, expect, test } from 'vitest'
import { output, run, start } from './vm-helpers.ts'

describe('PRINT (Doc 01 §7)', () => {
  test('a comma moves to the next 16-column zone', () => {
    expect(output('10 PRINT "A", "B"')).toBe(`A${' '.repeat(15)}B\n`)
  })

  test('a trailing ; or , keeps the line open', () => {
    expect(output('10 PRINT "A";\n20 PRINT "B"')).toBe('AB\n')
    expect(output('10 PRINT "A",\n20 PRINT "B"')).toBe(`A${' '.repeat(15)}B\n`)
  })

  test('evaluates every item before printing any, so a failing item prints nothing', () => {
    expect(output('10 PRINT "BEFORE"; 1 / 0')).toBe('?/0 ERROR IN 10\n')
  })

  test('a TAB out of range is ?FC, and nothing from that PRINT appears', () => {
    expect(output('10 PRINT "A"; TAB(300)')).toBe('?FC ERROR IN 10\n')
  })

  test('an error line starts on a new line if the column is not 0', () => {
    expect(output('10 PRINT "X";\n20 PRINT 1 / 0')).toBe('X\n?/0 ERROR IN 20\n')
  })

  test('CHR$(10) inside a string resets the column', () => {
    expect(output('10 PRINT "AB" + CHR$(10) + "C", "D"')).toBe(`AB\nC${' '.repeat(15)}D\n`)
  })

  test('CLS clears the console and resets the column', () => {
    expect(output('10 PRINT "XY";: CLS: PRINT "Z", "!"')).toBe(`XY\n[CLS]\nZ${' '.repeat(15)}!\n`)
  })
})

describe('INPUT (Doc 01 §8)', () => {
  test('a prompt followed by ; prints "? "', () => {
    expect(output('10 INPUT "AGE"; A\n20 PRINT A * 2', ['21'])).toBe('AGE? 21\n42\n')
  })

  test('a prompt followed by , prints just the prompt', () => {
    expect(output('10 INPUT "AGE", A', ['21'])).toBe('AGE21\n')
  })

  test('no prompt prints "? "', () => {
    expect(output('10 INPUT A', ['5'])).toBe('? 5\n')
  })

  test('the console is told what to label the input field', () => {
    const r = run('10 INPUT "AGE"; A\n20 INPUT B', ['1', '2'])
    expect(r.labels).toEqual(['AGE', '?'])
  })

  test('invalid input says ?REDO FROM START and asks again', () => {
    expect(output('10 INPUT A\n20 PRINT A', ['abc', '5'])).toBe('? abc\n?REDO FROM START\n? 5\n5\n')
  })

  test('too few values: ?? asks for the rest', () => {
    expect(output('10 INPUT A, B\n20 PRINT A + B', ['1', '2'])).toBe('? 1\n?? 2\n3\n')
  })

  test('too many values: ?EXTRA IGNORED', () => {
    expect(output('10 INPUT A\n20 PRINT A', ['1, 2'])).toBe('? 1, 2\n?EXTRA IGNORED\n1\n')
  })

  test('a single string target takes the whole line, trimmed', () => {
    expect(output('10 INPUT N$\n20 PRINT "["; N$; "]"', ['  SMITH, JOHN  '])).toBe(
      '?   SMITH, JOHN  \n[SMITH, JOHN]\n',
    )
  })

  test('with several targets, a quoted field can hold a comma', () => {
    expect(output('10 INPUT A$, B\n20 PRINT A$; "|"; B', ['"X, Y", 3'])).toBe(
      '? "X, Y", 3\nX, Y|3\n',
    )
  })

  test('a quoted field for a numeric target is invalid', () => {
    expect(output('10 INPUT A', ['"5"', '5'])).toBe('? "5"\n?REDO FROM START\n? 5\n')
  })

  test('a value that does not fit a % target is invalid', () => {
    expect(output('10 INPUT A%\n20 PRINT A%', ['1E16', '7.9'])).toBe(
      '? 1E16\n?REDO FROM START\n? 7.9\n7\n',
    )
  })

  test('?REDO FROM START discards everything this INPUT has read', () => {
    expect(output('10 INPUT A, B\n20 PRINT A; B', ['1', 'x', '3, 4'])).toBe(
      '? 1\n?? x\n?REDO FROM START\n? 3, 4\n34\n',
    )
  })

  test('targets are stored left to right after the line is accepted', () => {
    expect(output('10 INPUT I, A(I)\n20 PRINT A(3)', ['3, 7'])).toBe('? 3, 7\n7\n')
  })

  test('so a bad subscript is reported only after the input is accepted', () => {
    expect(output('10 DIM A(2)\n20 INPUT A(5)', ['1'])).toBe('? 1\n?BS ERROR IN 20\n')
  })

  test('while waiting, step and run do nothing and currentLine is the INPUT line', () => {
    const s = start('10 PRINT "Q"\n20 INPUT A\n30 PRINT A')
    expect(s.vm.run()).toBe('waiting-input')
    expect(s.vm.step()).toBe('waiting-input')
    expect(s.vm.currentLine()).toBe(20)
    expect(s.vm.provideInput('9')).toBe('running')
    expect(s.vm.run()).toBe('ended')
    expect(s.output()).toBe('Q\n? 9\n9\n')
  })

  test('provideInput when nothing is waiting is a host bug and throws', () => {
    const s = start('10 END')
    expect(() => s.vm.provideInput('x')).toThrow()
  })
})
