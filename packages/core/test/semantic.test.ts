import { describe, expect, test } from 'vitest'
import type { For, Next, Program, Stmt } from '../src/ast/ast.ts'
import { parse } from '../src/parser/parser.ts'
import { analyze } from '../src/semantic/analyze.ts'

function check(src: string) {
  const parsed = parse(src)
  expect(parsed.errors).toEqual([])
  return { program: parsed.program, ...analyze(parsed.program) }
}

/** Compile errors as `CODE@lineno`. */
const errs = (src: string) => check(src).errors.map((e) => `${e.code}@${e.lineno}`)
const msgs = (src: string) => check(src).errors.map((e) => e.message)

const allStmts = (program: Program): Stmt[] => {
  const out: Stmt[] = []
  const walk = (list: Stmt[]) => {
    for (const s of list) {
      out.push(s)
      if (s.kind === 'If') {
        if (s.then.kind === 'Stmts') walk(s.then.stmts)
        if (s.else?.kind === 'Stmts') walk(s.else.stmts)
      }
    }
  }
  for (const line of program.lines) walk(line.statements)
  return out
}

describe('the Index object (Doc 01 §17)', () => {
  test('has every field, with Phase 1 values', () => {
    const { index } = check('10 A = 1\n\n20 PRINT A')
    expect(index).toMatchObject({
      tier: 'L1',
      dialect: 'ignition',
      lines: [10, 20],
      procedures: [],
      lineMap: [
        { lineno: 10, line: 1 },
        { lineno: 20, line: 3 },
      ],
      warnings: [],
    })
  })

  test('lists variables by first occurrence, with display spelling, canonical name and type', () => {
    const { index } = check('10 Total = 1: name$ = "X": I% = 2\n20 TOTAL = total + 1')
    expect(index.variables).toEqual([
      { name: 'Total', canonical: 'TOTAL', type: 'number', array: null, firstLine: 10 },
      { name: 'name$', canonical: 'NAME$', type: 'string', array: null, firstLine: 10 },
      { name: 'I%', canonical: 'I%', type: 'integer', array: null, firstLine: 10 },
    ])
  })

  test('A, A% and A$ are different variables; A# and A! are A', () => {
    const { index } = check('10 A = 1: A% = 2: A$ = "X": A# = 3: A! = 4')
    expect(index.variables.map((v) => v.canonical)).toEqual(['A', 'A%', 'A$'])
  })

  test('an array and a scalar with the same name are separate entries', () => {
    const { index } = check('10 DIM A(5)\n20 A = A(2)')
    expect(index.variables).toEqual([
      {
        name: 'A',
        canonical: 'A',
        type: 'number',
        array: { dims: 1, implicit: false },
        firstLine: 10,
      },
      { name: 'A', canonical: 'A', type: 'number', array: null, firstLine: 20 },
    ])
  })

  test('warns IMPLICIT_DIM for an array with no DIM anywhere', () => {
    const { index } = check('10 DIM A(3)\n20 B(1) = A(1): C$(2, 2) = "X"')
    expect(index.variables.filter((v) => v.array).map((v) => [v.canonical, v.array])).toEqual([
      ['A', { dims: 1, implicit: false }],
      ['B', { dims: 1, implicit: true }],
      ['C$', { dims: 2, implicit: true }],
    ])
    expect(index.warnings.map((w) => [w.lineno, w.code])).toEqual([
      [20, 'IMPLICIT_DIM'],
      [20, 'IMPLICIT_DIM'],
    ])
  })

  test('a DIM later in the program still counts as a DIM', () => {
    const { index } = check('10 GOTO 30\n20 A(1) = 1\n30 DIM A(5)')
    expect(index.warnings).toEqual([])
  })
})

describe('arrays (Doc 01 §10)', () => {
  test('one dimension count for the whole program, DIM included', () => {
    expect(errs('10 DIM A(5)\n20 A(1, 2) = 3')).toEqual(['BS@20'])
    expect(errs('10 A(1) = 1\n20 PRINT A(1, 1)')).toEqual(['BS@20'])
  })
})

describe('types (Doc 01 §4 and §5)', () => {
  test('no implicit conversion between strings and numbers', () => {
    expect(errs('10 PRINT "A" + 1')).toEqual(['TM@10'])
    expect(errs('10 X$ = 5')).toEqual(['TM@10'])
    expect(errs('10 X = "A"')).toEqual(['TM@10'])
    expect(errs('10 IF A$ = 1 THEN 10')).toEqual(['TM@10'])
  })

  test('strings concatenate and compare', () => {
    expect(errs('10 A$ = "A" + "B": IF A$ < "M" THEN 10')).toEqual([])
  })

  test('a condition must be boolean, and the message says how to write it', () => {
    expect(errs('10 IF X THEN 10')).toEqual(['TM@10'])
    expect(msgs('10 IF X THEN 10')[0]).toContain('X <> 0')
  })

  test('a boolean cannot be stored, printed or passed to a function', () => {
    expect(errs('10 X = (A > B)')).toEqual(['TM@10'])
    expect(errs('10 PRINT A > B')).toEqual(['TM@10'])
    expect(errs('10 X = ABS(A > B)')).toEqual(['TM@10'])
  })

  test('comparing a boolean with a number explains that comparisons are true or false', () => {
    expect(errs('10 IF (A > B) = 1 THEN 10')).toEqual(['TM@10'])
    expect(msgs('10 IF (A > B) = 1 THEN 10')[0]).toContain('-1')
  })

  test('AND, OR and NOT take booleans', () => {
    expect(errs('10 IF A AND B THEN 10')).toEqual(['TM@10'])
    expect(errs('10 IF NOT 5 THEN 10')).toEqual(['TM@10'])
    expect(errs('10 IF A > 1 AND NOT B < 2 OR C = 3 THEN 10')).toEqual([])
  })

  test('arithmetic takes numbers', () => {
    expect(errs('10 X = -"A"')).toEqual(['TM@10'])
    expect(errs('10 X = "A" * 2')).toEqual(['TM@10'])
    expect(errs('10 X = 7 \\ 2 + 7 MOD 2 + 2 ^ 3')).toEqual([])
  })

  test('subscripts are numbers', () => {
    expect(errs('10 A(1 > 2) = 1')).toEqual(['TM@10'])
    expect(errs('10 PRINT A("X")')).toEqual(['TM@10'])
  })

  test('statement operands have the types their statements need', () => {
    expect(errs('10 FOR A$ = 1 TO 2: NEXT A$')).toEqual(['TM@10'])
    expect(errs('10 FOR I = "A" TO 2: NEXT I')).toEqual(['TM@10'])
    expect(errs('10 ON "A" GOTO 10')).toEqual(['TM@10'])
    expect(errs('10 DIM A("X")')).toEqual(['TM@10'])
    expect(errs('10 RANDOMIZE "X"')).toEqual(['TM@10'])
    expect(errs('10 PRINT TAB("X")')).toEqual(['TM@10'])
    expect(errs('10 MID$(A, 1) = "X"')).toEqual(['TM@10'])
    expect(errs('10 MID$(A$, 1) = 2')).toEqual(['TM@10'])
  })
})

describe('built-in functions (Doc 01 §12)', () => {
  test('arguments have the documented types', () => {
    expect(errs('10 X = LEN(5)')).toEqual(['TM@10'])
    expect(errs('10 X$ = LEFT$(5, 1)')).toEqual(['TM@10'])
    expect(errs('10 X$ = STRING$("A", 3)')).toEqual(['TM@10'])
    expect(errs('10 X = INSTR("A", 1)')).toEqual(['TM@10'])
  })

  test('the right number of arguments', () => {
    expect(errs('10 X$ = LEFT$("A")')).toEqual(['SN@10'])
    expect(errs('10 X = MIN(1)')).toEqual(['SN@10'])
    expect(errs('10 X = ABS(1, 2)')).toEqual(['SN@10'])
  })

  test('optional and flexible arguments', () => {
    expect(
      errs(
        '10 X = ROUND(1.5) + ROUND(1.5, 1) + INSTR("AB", "B") + INSTR(2, "AB", "B") + MAX(1, 2, 3)',
      ),
    ).toEqual([])
    expect(
      errs('10 X$ = MID$("AB", 1) + MID$("AB", 1, 1) + STRING$(2, "A") + STRING$(2, 65)'),
    ).toEqual([])
  })

  test('result types', () => {
    expect(errs('10 X = STR$(1)')).toEqual(['TM@10'])
    expect(errs('10 X$ = VAL("1")')).toEqual(['TM@10'])
    expect(errs('10 X = TIMER + RND(1) + ASC("A") + LEN("A")')).toEqual([])
  })
})

describe('line numbers in jumps (Doc 01 §9)', () => {
  test('a jump or RESTORE to a missing line is ?UL', () => {
    expect(errs('10 GOTO 99')).toEqual(['UL@10'])
    expect(errs('10 GOSUB 99')).toEqual(['UL@10'])
    expect(errs('10 IF X > 1 THEN 99 ELSE 98')).toEqual(['UL@10', 'UL@10'])
    expect(errs('10 ON X GOTO 10, 99')).toEqual(['UL@10'])
    expect(errs('10 RESTORE 99')).toEqual(['UL@10'])
  })
})

describe('FOR and NEXT pair by position (Doc 01 §9)', () => {
  test('each NEXT closes the innermost open FOR', () => {
    const src = '10 FOR I = 1 TO 2\n20 FOR J = 1 TO 2\n30 NEXT\n40 NEXT I'
    const { closes, program } = check(src)
    const stmts = allStmts(program)
    const forI = stmts[0] as For
    const forJ = stmts[1] as For
    expect(closes.get(stmts[2] as Next)).toEqual([forJ])
    expect(closes.get(stmts[3] as Next)).toEqual([forI])
  })

  test('NEXT J, I closes two loops, innermost first', () => {
    const src = '10 FOR I = 1 TO 2: FOR J = 1 TO 2\n20 NEXT J, I'
    const { closes, closers, program } = check(src)
    const stmts = allStmts(program)
    const next = stmts[2] as Next
    expect(closes.get(next)).toEqual([stmts[1], stmts[0]])
    expect(closers.get(stmts[0] as For)).toEqual({ next, position: 1 })
  })

  test('a NEXT with no open FOR, or the wrong name, is ?NF', () => {
    expect(errs('10 NEXT I')).toEqual(['NF@10'])
    expect(errs('10 FOR I = 1 TO 2\n20 NEXT J')).toEqual(['NF@20'])
    expect(errs('10 FOR I = 1 TO 2\n20 NEXT I, J')).toEqual(['NF@20'])
  })

  test('a FOR without a NEXT is ?SN', () => {
    expect(errs('10 FOR I = 1 TO 2')).toEqual(['SN@10'])
  })

  test('FOR and NEXT must be in the same statement list', () => {
    expect(errs('10 FOR I = 1 TO 2\n20 IF X > 1 THEN NEXT I')).toEqual(['SN@10', 'NF@20'])
    expect(errs('10 IF X > 1 THEN FOR I = 1 TO 2: PRINT I: NEXT I')).toEqual([])
  })
})

describe('jumping into a loop is a compile error (Doc 01 §9)', () => {
  const loop = '20 FOR I = 1 TO 3\n30 PRINT I\n40 NEXT I\n'

  test('from outside to a line inside the region', () => {
    expect(errs(`10 GOTO 30\n${loop}`)).toEqual(['SN@10'])
    expect(msgs(`10 GOTO 30\n${loop}`)[0]).toContain('GOTO 30 jumps into the FOR loop at line 20')
  })

  test('to the NEXT line, or by GOSUB, is also into the loop', () => {
    expect(errs(`10 GOTO 40\n${loop}`)).toEqual(['SN@10'])
    expect(errs(`10 GOSUB 30\n${loop}`)).toEqual(['SN@10'])
  })

  test('jumping to the FOR line itself, out of the loop, or within it is fine', () => {
    expect(errs(`10 GOTO 20\n${loop}`)).toEqual([])
    expect(errs('10 FOR I = 1 TO 3\n20 IF I = 2 THEN 50\n30 GOTO 40\n40 NEXT I\n50 END')).toEqual(
      [],
    )
  })

  test('from an outer loop into an inner one', () => {
    const src = '10 FOR I = 1 TO 2\n20 GOTO 40\n30 FOR J = 1 TO 2\n40 PRINT J\n50 NEXT J\n60 NEXT I'
    expect(errs(src)).toEqual(['SN@20'])
  })

  test('a line with no statements belongs where execution continues', () => {
    expect(errs('10 GOTO 30\n20 FOR I = 1 TO 2\n30\n40 NEXT I')).toEqual(['SN@10'])
  })
})

describe('the DATA pool (Doc 01 §11)', () => {
  test('holds every item in program order, and RESTORE n finds the first item at or after n', () => {
    const { data, restoreIndex } = check('10 DATA 1, 2\n20 READ A\n30 DATA "X"\n40 END\n50 DATA 3')
    expect(data.map((d) => d.value)).toEqual([1, 2, 'X', 3])
    expect([10, 20, 30, 40, 50].map((n) => restoreIndex(n))).toEqual([0, 2, 2, 3, 3])
  })
})
