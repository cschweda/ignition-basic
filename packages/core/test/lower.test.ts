import { describe, expect, test } from 'vitest'
import { parse } from '../src/parser/parser.ts'
import { analyze } from '../src/semantic/analyze.ts'
import { lower } from '../src/lower/lower.ts'
import type { Instr } from '../src/lower/ir.ts'

function lowered(src: string) {
  const parsed = parse(src)
  expect(parsed.errors).toEqual([])
  const analysis = analyze(parsed.program)
  expect(analysis.errors).toEqual([])
  return lower(parsed.program, analysis)
}

/** One line per instruction; helpers (not steps) start with `~`. */
function show(i: Instr): string {
  const s = i.step ? '' : '~'
  switch (i.op) {
    case 'if':
      return `${s}if T:${i.whenTrue} F:${i.whenFalse}`
    case 'for':
      return `${s}for ${i.stmt.variable.name.canonical} exit:${i.exit}`
    case 'next':
      return `${s}next ${i.variable.name.canonical} body:${i.body}`
    case 'goto':
      return `${s}goto ${i.target}`
    case 'gosub':
      return `${s}gosub ${i.target} resume:${i.resume}`
    case 'on':
      return `${s}on ${i.mode} ${i.targets.join(',')} resume:${i.resume}`
    case 'jump':
      return `${s}jump ${i.target}`
    case 'restore':
      return `${s}restore ${i.dataIndex}`
    default:
      return s + i.op
  }
}

const ops = (src: string) => lowered(src).instrs.map(show)

describe('straight-line code (Doc 01 §16)', () => {
  test('each statement becomes one step instruction', () => {
    expect(ops('10 A = 1: PRINT A\n20 INPUT B\n30 CLS: END')).toEqual([
      'let',
      'print',
      'input',
      'cls',
      'end',
    ])
  })

  test('comments and DATA are kept, but are not steps', () => {
    expect(ops("10 REM HI\n20 PRINT ' NOTE\n30 DATA 1")).toEqual(['~rem', 'print', '~rem', '~data'])
  })

  test('every instruction carries its line number and source position', () => {
    const { instrs } = lowered('10 CLS\n20 PRINT: END')
    expect(instrs.map((i) => [i.lineno, i.pos])).toEqual([
      [10, { line: 1, col: 4 }],
      [20, { line: 2, col: 4 }],
      [20, { line: 2, col: 11 }],
    ])
  })
})

describe('line targets', () => {
  test('a jump lands on the first instruction of its line', () => {
    expect(ops('10 GOTO 30\n20 PRINT\n30 END')).toEqual(['goto 2', 'print', 'end'])
  })

  test('a line with no statements lands on the next instruction, or the end', () => {
    const { lineStart, instrs } = lowered('10 GOTO 20\n20\n30 END\n40')
    expect([lineStart.get(10), lineStart.get(20), lineStart.get(30), lineStart.get(40)]).toEqual([
      0,
      1,
      1,
      instrs.length,
    ])
  })

  test('GOSUB and ON resume at the next instruction', () => {
    expect(ops('10 GOSUB 30: PRINT\n20 ON X GOSUB 30, 40\n30 RETURN\n40 RETURN')).toEqual([
      'gosub 3 resume:1',
      'print',
      'on GOSUB 3,4 resume:3',
      'return',
      'return',
    ])
  })

  test('RESTORE n points at the first DATA item on line n or later', () => {
    expect(ops('10 RESTORE 30: RESTORE\n20 DATA 1, 2\n30 DATA 3')).toEqual([
      'restore 2',
      'restore 0',
      '~data',
      '~data',
    ])
  })
})

describe('IF lowers to one step and, at most, one helper jump (Doc 01 §9)', () => {
  test('THEN n', () => {
    expect(ops('10 IF X > 1 THEN 30\n20 PRINT\n30 END')).toEqual(['if T:2 F:1', 'print', 'end'])
  })

  test('THEN n ELSE n', () => {
    expect(ops('10 IF X > 1 THEN 20 ELSE 30\n20 PRINT\n30 END')).toEqual([
      'if T:1 F:2',
      'print',
      'end',
    ])
  })

  test('THEN statements: false skips the rest of the line', () => {
    expect(ops('10 IF X > 1 THEN PRINT: PRINT\n20 END')).toEqual([
      'if T:1 F:3',
      'print',
      'print',
      'end',
    ])
  })

  test('THEN statements ELSE statements: the THEN branch jumps over the ELSE branch', () => {
    expect(ops('10 IF X > 1 THEN PRINT ELSE CLS: CLS\n20 END')).toEqual([
      'if T:1 F:3',
      'print',
      '~jump 5',
      'cls',
      'cls',
      'end',
    ])
  })

  test('THEN n ELSE statements', () => {
    expect(ops('10 IF X > 1 THEN 20 ELSE PRINT\n20 END')).toEqual(['if T:2 F:1', 'print', 'end'])
  })

  test('THEN statements ELSE n', () => {
    expect(ops('10 IF X > 1 THEN PRINT ELSE 30\n20 CLS\n30 END')).toEqual([
      'if T:1 F:3',
      'print',
      'cls',
      'end',
    ])
  })
})

describe('FOR and NEXT (Doc 01 §9)', () => {
  test('FOR exits past its NEXT; NEXT loops back to the instruction after the FOR', () => {
    expect(ops('10 FOR I = 1 TO 3\n20 PRINT I\n30 NEXT I\n40 END')).toEqual([
      'for I exit:3',
      'print',
      'next I body:1',
      'end',
    ])
  })

  test('NEXT J, I is one step that may continue into a helper for I', () => {
    expect(ops('10 FOR I = 1 TO 2: FOR J = 1 TO 2\n20 PRINT\n30 NEXT J, I\n40 END')).toEqual([
      'for I exit:5',
      'for J exit:4',
      'print',
      'next J body:2',
      '~next I body:1',
      'end',
    ])
  })

  test('each FOR gets its own loop id', () => {
    const { instrs } = lowered('10 FOR I = 1 TO 2: NEXT I\n20 FOR I = 1 TO 2: NEXT I')
    const loops = instrs.flatMap((i) => (i.op === 'for' || i.op === 'next' ? [i.loop] : []))
    expect(loops).toEqual([0, 0, 1, 1])
  })
})
