import { describe, expect, test } from 'vitest'
import { forceIdle } from '../src/interp/testing.ts'
import { output, run, start } from './vm-helpers.ts'

describe('RND, RANDOMIZE and TIMER (Doc 01 §13 and §14)', () => {
  test('an unseeded program starts from seed 0', () => {
    expect(output('10 PRINT RND(1)')).toBe('0.314838805262153\n')
  })

  test('a bare RANDOMIZE seeds from the host entropy', () => {
    expect(run('10 RANDOMIZE: PRINT RND(6)', [], { entropy: () => 42 }).output()).toBe('6\n')
  })

  test('TIMER reads seconds from the host clock since the program started', () => {
    expect(output('10 PRINT TIMER: PRINT TIMER')).toBe('0.001\n0.002\n')
  })

  test('a busy wait on the virtual clock still finishes', () => {
    expect(output('10 IF TIMER < 1 THEN 10\n20 PRINT "DONE"')).toBe('DONE\n')
  })
})

describe('stepping (Doc 01 §16)', () => {
  test('step runs exactly one statement', () => {
    const s = start('10 PRINT "A": PRINT "B"\n20 PRINT "C"')
    expect(s.vm.currentLine()).toBe(10)
    expect(s.vm.step()).toBe('running')
    expect(s.output()).toBe('A\n')
    expect(s.vm.currentLine()).toBe(10)
    s.vm.step()
    expect(s.output()).toBe('A\nB\n')
    expect(s.vm.currentLine()).toBe(20)
    expect(s.vm.step()).toBe('ended')
    expect(s.output()).toBe('A\nB\nC\n')
  })

  test('comments and DATA are not steps', () => {
    const s = start('10 REM HELLO\n20 DATA 1\n30 PRINT "A"')
    expect(s.vm.currentLine()).toBe(30)
  })

  test('an IF is one step, and each statement of its branch another', () => {
    const s = start('10 IF 1 = 1 THEN PRINT "A": PRINT "B"')
    s.vm.step()
    expect(s.output()).toBe('')
    s.vm.step()
    expect(s.output()).toBe('A\n')
    s.vm.step()
    expect(s.output()).toBe('A\nB\n')
  })

  test('NEXT J, I is one step', () => {
    const s = start('10 FOR I = 1 TO 1: FOR J = 1 TO 1\n20 NEXT J, I\n30 PRINT "OUT"')
    s.vm.step()
    s.vm.step()
    s.vm.step()
    expect(s.vm.currentLine()).toBe(30)
  })

  test('run stops after its budget of statements', () => {
    const s = start('10 GOTO 10')
    expect(s.vm.run(5)).toBe('running')
    expect(s.vm.currentLine()).toBe(10)
  })
})

describe('the idle state and dispatch: the hook for Phase 6 (Doc 01 §16)', () => {
  const program = `10 PRINT "MAIN"
20 END
100 PRINT "CLICK "; C: C = C + 1
110 RETURN
200 GOSUB 300: RETURN
300 PRINT "NESTED": RETURN
400 PRINT "BYE": END`

  test('step and run do nothing while idle', () => {
    const s = start(program)
    forceIdle(s.vm)
    expect(s.vm.run()).toBe('idle')
    expect(s.vm.step()).toBe('idle')
    expect(s.vm.currentLine()).toBeNull()
    expect(s.output()).toBe('')
  })

  test('a dispatched event runs its GOSUB handler to completion, then the VM is idle again', () => {
    const s = start(program)
    forceIdle(s.vm)
    s.vm.registerHandler('click', 'ok', { gosub: 100 })
    s.vm.dispatch({ kind: 'click', id: 'ok' })
    expect(s.vm.currentLine()).toBe(100)
    expect(s.vm.run()).toBe('idle')
    s.vm.dispatch({ kind: 'click', id: 'ok' })
    expect(s.vm.run()).toBe('idle')
    expect(s.output()).toBe('CLICK 0\nCLICK 1\n')
  })

  test('events that arrive during a handler wait their turn; a handler is never re-entered', () => {
    const s = start(program)
    forceIdle(s.vm)
    s.vm.registerHandler('click', 'ok', { gosub: 100 })
    s.vm.dispatch({ kind: 'click', id: 'ok' })
    s.vm.step()
    s.vm.dispatch({ kind: 'click', id: 'ok' })
    expect(s.vm.currentLine()).toBe(100)
    expect(s.vm.run()).toBe('idle')
    expect(s.output()).toBe('CLICK 0\nCLICK 1\n')
  })

  test('a handler that calls a subroutine still returns to idle', () => {
    const s = start(program)
    forceIdle(s.vm)
    s.vm.registerHandler('click', 'nested', { gosub: 200 })
    s.vm.dispatch({ kind: 'click', id: 'nested' })
    expect(s.vm.run()).toBe('idle')
    expect(s.output()).toBe('NESTED\n')
  })

  test('END inside a handler ends the program', () => {
    const s = start(program)
    forceIdle(s.vm)
    s.vm.registerHandler('close', 'window', { gosub: 400 })
    s.vm.dispatch({ kind: 'close', id: 'window' })
    expect(s.vm.run()).toBe('ended')
  })

  test('an event with no handler is ignored', () => {
    const s = start(program)
    forceIdle(s.vm)
    s.vm.dispatch({ kind: 'click', id: 'nobody' })
    expect(s.vm.run()).toBe('idle')
    expect(s.output()).toBe('')
  })

  test('registering a handler for a missing line, or for a SUB, throws', () => {
    const s = start(program)
    expect(() => s.vm.registerHandler('click', 'ok', { gosub: 999 })).toThrow()
    expect(() => s.vm.registerHandler('click', 'ok', { sub: 'Save' })).toThrow(/Phase 2/)
  })

  test('a program that never goes idle never runs a handler', () => {
    const s = start(program)
    s.vm.registerHandler('click', 'ok', { gosub: 100 })
    s.vm.dispatch({ kind: 'click', id: 'ok' })
    expect(s.vm.run()).toBe('ended')
    expect(s.output()).toBe('MAIN\n')
  })
})
