import { describe, expect, test } from 'vitest'
import { output, run, start } from './vm-helpers.ts'

describe('IF (Doc 01 §9)', () => {
  test('THEN and ELSE branches of statements', () => {
    const src = `10 X = 5
20 IF X > 3 THEN PRINT "BIG" ELSE PRINT "SMALL"
30 IF X > 9 THEN PRINT "HUGE": PRINT "!"
40 PRINT "DONE"`
    expect(output(src)).toBe('BIG\nDONE\n')
  })

  test('THEN n and ELSE n jump', () => {
    expect(output('10 IF 1 > 2 THEN 30 ELSE 40\n30 PRINT "A"\n40 PRINT "B"')).toBe('B\n')
  })

  test('an ELSE belongs to the nearest IF', () => {
    expect(output('10 A = 1: B = 0\n20 IF A = 1 THEN IF B = 1 THEN PRINT "X" ELSE PRINT "Y"')).toBe(
      'Y\n',
    )
  })
})

describe('FOR and NEXT (Doc 01 §9)', () => {
  test('the test comes before the body, so a loop can run zero times', () => {
    expect(output('10 FOR I = 1 TO 0: PRINT "NO": NEXT I\n20 PRINT I')).toBe('1\n')
  })

  test('after a normal exit the variable holds the first value that failed', () => {
    expect(output('10 FOR I = 1 TO 9 STEP 3: NEXT I\n20 PRINT I')).toBe('10\n')
  })

  test('a negative STEP counts down', () => {
    expect(output('10 FOR I = 3 TO 1 STEP -1: PRINT I;: NEXT I\n20 PRINT')).toBe('321\n')
  })

  test('the limit and step are evaluated once', () => {
    expect(output('10 N = 3\n20 FOR I = 1 TO N: N = 10: PRINT I;: NEXT I\n30 PRINT')).toBe('123\n')
  })

  test('a % loop variable truncates each value it takes', () => {
    expect(output('10 FOR I% = 1 TO 3 STEP 1.5: PRINT I%;: NEXT I%\n20 PRINT')).toBe('123\n')
  })

  test('STEP 0 with the test passing loops forever', () => {
    const s = start('10 FOR I = 1 TO 2 STEP 0\n20 NEXT I')
    expect(s.vm.run(1000)).toBe('running')
  })

  test('jumping back to the FOR line restarts the loop', () => {
    const src = `10 C = 0
20 FOR I = 1 TO 3
30 C = C + 1
40 IF C = 2 THEN 20
50 NEXT I
60 PRINT C`
    expect(output(src)).toBe('5\n')
  })

  test("loop records live in the current frame, so a subroutine cannot NEXT its caller's loop", () => {
    const src = `10 FOR I = 1 TO 2
20 GOSUB 40
30 GOTO 50
40 GOTO 50
50 NEXT I`
    expect(output(src)).toBe('?NF ERROR IN 50\n')
  })
})

describe('GOSUB and RETURN (Doc 01 §9)', () => {
  test('RETURN continues after the GOSUB, on the same line if there is more', () => {
    expect(output('10 GOSUB 100: PRINT "BACK"\n20 END\n100 PRINT "SUB"\n110 RETURN')).toBe(
      'SUB\nBACK\n',
    )
  })

  test('RETURN without GOSUB raises ?RG', () => {
    expect(output('10 RETURN')).toBe('?RG ERROR IN 10\n')
  })

  test('1,000 active GOSUBs are allowed', () => {
    expect(output('10 D = D + 1: IF D <= 1000 THEN GOSUB 10\n20 PRINT D: END')).toBe('1001\n')
  })

  test('the 1,001st raises ?OM', () => {
    expect(output('10 D = D + 1: IF D <= 1001 THEN GOSUB 10\n20 PRINT D: END')).toBe(
      '?OM ERROR IN 10\n',
    )
  })
})

describe('ON … GOTO and ON … GOSUB (Doc 01 §9)', () => {
  const menu = '20 PRINT "NONE": END\n30 PRINT "ONE": END\n40 PRINT "TWO": END'

  test('jumps to the nth target, truncating', () => {
    expect(output(`10 ON 2.9 GOTO 30, 40\n${menu}`)).toBe('TWO\n')
  })

  test('0, or more than the number of targets, continues with the next statement', () => {
    expect(output(`10 ON 0 GOTO 30, 40\n${menu}`)).toBe('NONE\n')
    expect(output(`10 ON 3 GOTO 30, 40\n${menu}`)).toBe('NONE\n')
    expect(output(`10 ON -0.5 GOTO 30, 40\n${menu}`)).toBe('NONE\n')
  })

  test('a negative or non-finite value raises ?FC', () => {
    expect(output(`10 ON -1 GOTO 30, 40\n${menu}`)).toBe('?FC ERROR IN 10\n')
    expect(output(`10 ON 1E308 * 10 GOTO 30, 40\n${menu}`)).toBe('?FC ERROR IN 10\n')
  })

  test('ON … GOSUB returns to the statement after the ON', () => {
    const src =
      '10 ON 2 GOSUB 100, 200: PRINT "BACK"\n20 END\n100 PRINT "ONE": RETURN\n200 PRINT "TWO": RETURN'
    expect(output(src)).toBe('TWO\nBACK\n')
  })
})

describe('END, STOP and runtime errors (Doc 01 §9 and §15)', () => {
  test('STOP prints BREAK IN n on a line of its own and ends', () => {
    const r = run('10 PRINT "A";: STOP\n20 PRINT "B"')
    expect(r.output()).toBe('A\nBREAK IN 10\n')
    expect(r.status).toBe('ended')
  })

  test('the error object carries the code, a long message, the line and the position', () => {
    const r = run('10 DIM A(10)\n20 PRINT A(11)')
    expect(r.status).toBe('error')
    expect(r.vm.error()).toEqual({
      code: 'BS',
      message: 'Subscript out of range: A(11), upper bound 10',
      lineno: 20,
      pos: { line: 2, col: 4 },
      phase: 'runtime',
    })
    expect(r.vm.currentLine()).toBe(20)
  })

  test('after an error, step and run keep returning error', () => {
    const r = run('10 PRINT 1 / 0\n20 PRINT "NO"')
    expect(r.vm.step()).toBe('error')
    expect(r.vm.run()).toBe('error')
  })

  test('after the end, step and run keep returning ended and currentLine is null', () => {
    const r = run('10 END')
    expect(r.vm.step()).toBe('ended')
    expect(r.vm.currentLine()).toBeNull()
  })
})
