import { describe, expect, test } from 'vitest'
import type { Expr, Stmt } from '../src/ast/ast.ts'
import { parse } from '../src/parser/parser.ts'

/** Renders an expression as an S-expression, so precedence is visible in assertions. */
function sexpr(e: Expr): string {
  switch (e.kind) {
    case 'Number':
      return String(e.value)
    case 'String':
      return JSON.stringify(e.value)
    case 'Var':
      return e.name.canonical
    case 'Index':
      return `(index ${e.name.canonical} ${e.indices.map(sexpr).join(' ')})`
    case 'Call':
      return e.args.length === 0 ? `(${e.fn})` : `(${e.fn} ${e.args.map(sexpr).join(' ')})`
    case 'Unary':
      return `(${e.op} ${sexpr(e.operand)})`
    case 'Binary':
      return `(${e.op} ${sexpr(e.left)} ${sexpr(e.right)})`
    case 'Paren':
      return `(paren ${sexpr(e.expr)})`
  }
}

/** Parses `10 X = <src>` and returns the right-hand side. */
function expr(src: string): string {
  const { program, errors } = parse(`10 X = ${src}`)
  expect(errors).toEqual([])
  const stmt = program.lines[0]?.statements[0]
  if (stmt?.kind !== 'Let') throw new Error('expected a LET')
  return sexpr(stmt.value)
}

function stmts(src: string): Stmt[] {
  const { program, errors } = parse(src)
  expect(errors).toEqual([])
  return program.lines.flatMap((l) => l.statements)
}

const first = (src: string): Stmt => {
  const s = stmts(src)[0]
  if (s === undefined) throw new Error('no statement')
  return s
}

const errorCodes = (src: string) => parse(src).errors.map((e) => `${e.code}@${e.lineno}`)
const messages = (src: string) => parse(src).errors.map((e) => e.message)

describe('program structure (Doc 01 §2)', () => {
  test('lines hold statements separated by colons; empty statements vanish', () => {
    const { program } = parse('10 CLS: END\n20 ::END:\n30')
    expect(program.lines.map((l) => [l.lineno, l.statements.map((s) => s.kind)])).toEqual([
      [10, ['Cls', 'End']],
      [20, ['End']],
      [30, []],
    ])
  })

  test('every statement knows its line number', () => {
    expect(stmts('10 CLS\n20 END').map((s) => s.lineno)).toEqual([10, 20])
  })

  test('line numbers must strictly increase', () => {
    expect(errorCodes('20 END\n10 END')).toEqual(['SN@10'])
    expect(errorCodes('10 END\n10 END')).toEqual(['SN@10'])
  })

  test('one bad line is reported and the rest still parse', () => {
    const { program, errors } = parse('10 PRINT 1\n20 GOTO X\n30 PRINT +\n40 END')
    expect(errors.map((e) => e.lineno)).toEqual([20, 30])
    expect(program.lines.map((l) => l.lineno)).toEqual([10, 20, 30, 40])
  })

  test('a line the lexer rejected is not reported twice', () => {
    expect(errorCodes('10 LEFT = 1')).toEqual(['SN@10'])
  })
})

describe('expressions (Doc 01 §5)', () => {
  test('* binds tighter than +', () => {
    expect(expr('1 + 2 * 3')).toBe('(+ 1 (* 2 3))')
  })

  test('\\ and MOD share a level with * and /', () => {
    expect(expr('7 \\ 2 * 3')).toBe('(* (\\ 7 2) 3)')
    expect(expr('A MOD B + C')).toBe('(+ (MOD A B) C)')
  })

  test('^ is right-associative and binds tighter than a unary minus on its left', () => {
    expect(expr('-2 ^ 2')).toBe('(- (^ 2 2))')
    expect(expr('2 ^ -1')).toBe('(^ 2 (- 1))')
    expect(expr('2 ^ 3 ^ 2')).toBe('(^ 2 (^ 3 2))')
  })

  test('NOT is looser than comparisons, AND than NOT, OR than AND', () => {
    expect(expr('NOT A = B')).toBe('(NOT (= A B))')
    expect(expr('A < B AND C > D OR E = F')).toBe('(OR (AND (< A B) (> C D)) (= E F))')
  })

  test('comparisons do not chain', () => {
    expect(errorCodes('10 X = A < B < C')).toEqual(['SN@10'])
  })

  test('parentheses are kept', () => {
    expect(expr('(1 + 2) * 3')).toBe('(* (paren (+ 1 2)) 3)')
  })

  test('built-in calls, array elements and TIMER', () => {
    expect(expr('LEFT$(A$, 2)')).toBe('(LEFT$ A$ 2)')
    expect(expr('A(1, J + 1)')).toBe('(index A 1 (+ J 1))')
    expect(expr('TIMER + 1')).toBe('(+ (TIMER) 1)')
  })

  test('TIMER takes no parentheses', () => {
    expect(errorCodes('10 X = TIMER()')).toEqual(['SN@10'])
  })

  test('TAB is only a PRINT item', () => {
    expect(errorCodes('10 X = TAB(5)')).toEqual(['SN@10'])
  })

  test('a function from a later phase is ?SN, with a message saying when it arrives', () => {
    expect(messages('10 X$ = INKEY$')).toEqual([expect.stringContaining('Phase 5')])
  })
})

describe('assignment', () => {
  test('LET is optional', () => {
    expect(first('10 LET A = 1')).toMatchObject({ kind: 'Let', keyword: true })
    expect(first('10 A = 1')).toMatchObject({ kind: 'Let', keyword: false })
  })

  test('the target can be an array element', () => {
    const s = first('10 A(1, 2) = 3')
    expect(s.kind === 'Let' && sexpr(s.target)).toBe('(index A 1 2)')
  })

  test('a missing = is ?SN', () => {
    expect(errorCodes('10 A 1')).toEqual(['SN@10'])
  })
})

describe('PRINT (Doc 01 §7)', () => {
  test('keeps items and separators in order', () => {
    const s = first('10 PRINT "A"; B, TAB(5); "C";')
    expect(s.kind === 'Print' && s.items.map((i) => i.kind)).toEqual([
      'Expr',
      'Semicolon',
      'Expr',
      'Comma',
      'Tab',
      'Semicolon',
      'Expr',
      'Semicolon',
    ])
  })

  test('a bare PRINT has no items', () => {
    expect(first('10 PRINT')).toMatchObject({ kind: 'Print', items: [] })
  })

  test('items need a separator between them', () => {
    expect(errorCodes('10 PRINT "A" "B"')).toEqual(['SN@10'])
    expect(errorCodes('10 PRINT TAB(5)"X"')).toEqual(['SN@10'])
  })
})

describe('INPUT (Doc 01 §8)', () => {
  test('an optional prompt followed by ; or ,', () => {
    expect(first('10 INPUT "NAME"; N$')).toMatchObject({
      kind: 'Input',
      prompt: { text: 'NAME', separator: ';' },
    })
    expect(first('10 INPUT "X", A')).toMatchObject({ prompt: { text: 'X', separator: ',' } })
    expect(first('10 INPUT A, B(1)')).toMatchObject({ prompt: null })
  })

  test('targets are variables or array elements', () => {
    const s = first('10 INPUT A, B(1)')
    expect(s.kind === 'Input' && s.targets.map(sexpr)).toEqual(['A', '(index B 1)'])
  })

  test('a prompt needs its separator, and INPUT needs a target', () => {
    expect(errorCodes('10 INPUT "X" A')).toEqual(['SN@10'])
    expect(errorCodes('10 INPUT')).toEqual(['SN@10'])
    expect(errorCodes('10 INPUT "X";')).toEqual(['SN@10'])
  })
})

describe('IF (Doc 01 §9)', () => {
  test('THEN takes a line number or statements, and so does ELSE', () => {
    expect(first('10 IF X THEN 100')).toMatchObject({
      then: { kind: 'Line', target: { lineno: 100 } },
      else: null,
    })
    const s = first('10 IF X THEN PRINT 1: PRINT 2 ELSE 200')
    expect(s.kind === 'If' && s.then.kind === 'Stmts' && s.then.stmts.length).toBe(2)
    expect(s).toMatchObject({ else: { kind: 'Line', target: { lineno: 200 } } })
  })

  test('the ELSE branch runs to the end of the line', () => {
    const s = first('10 IF X THEN 100 ELSE PRINT 1: PRINT 2')
    expect(s.kind === 'If' && s.else?.kind === 'Stmts' && s.else.stmts.length).toBe(2)
  })

  test('each ELSE belongs to the nearest IF that does not have one yet', () => {
    const s = first('10 IF A THEN IF B THEN 1 ELSE 2 ELSE 3')
    expect(s).toMatchObject({
      kind: 'If',
      then: {
        kind: 'Stmts',
        stmts: [{ kind: 'If', else: { kind: 'Line', target: { lineno: 2 } } }],
      },
      else: { kind: 'Line', target: { lineno: 3 } },
    })
  })

  test('after THEN n only ELSE or the end of the line may follow', () => {
    expect(errorCodes('10 IF X THEN 100 PRINT 1')).toEqual(['SN@10'])
  })

  test('IF … GOTO without THEN is not supported', () => {
    expect(errorCodes('10 IF X GOTO 100')).toEqual(['SN@10'])
  })

  test('an ELSE with no IF to take it is ?SN', () => {
    expect(errorCodes('10 PRINT 1 ELSE 20')).toEqual(['SN@10'])
    expect(errorCodes('10 IF X THEN 1 ELSE 2 ELSE 3')).toEqual(['SN@10'])
  })

  test('a comment after THEN n follows the IF', () => {
    expect(stmts("10 IF X THEN 100 ' GO").map((s) => s.kind)).toEqual(['If', 'Rem'])
  })
})

describe('loops and jumps (Doc 01 §9)', () => {
  test('FOR with and without STEP', () => {
    const s = first('10 FOR I = 1 TO 10 STEP 2')
    expect(s.kind === 'For' && [s.variable.name.canonical, sexpr(s.from), sexpr(s.to)]).toEqual([
      'I',
      '1',
      '10',
    ])
    expect(s.kind === 'For' && s.step && sexpr(s.step)).toBe('2')
    expect(first('10 FOR I% = 1 TO 2')).toMatchObject({ step: null })
  })

  test('the FOR variable is a simple variable', () => {
    expect(errorCodes('10 FOR A(1) = 1 TO 2')).toEqual(['SN@10'])
  })

  test('NEXT with zero, one or several variables', () => {
    expect(first('10 NEXT')).toMatchObject({ kind: 'Next', variables: [] })
    const s = first('10 NEXT J, I')
    expect(s.kind === 'Next' && s.variables.map((v) => v.name.canonical)).toEqual(['J', 'I'])
  })

  test('GOTO, GOSUB and ON take literal line numbers', () => {
    expect(first('10 GOTO 100')).toMatchObject({ kind: 'Goto', target: { lineno: 100 } })
    expect(first('10 GOSUB 200')).toMatchObject({ kind: 'Gosub', target: { lineno: 200 } })
    const on = first('10 ON X GOSUB 10, 20, 30')
    expect(on.kind === 'On' && [on.mode, on.targets.map((t) => t.lineno)]).toEqual([
      'GOSUB',
      [10, 20, 30],
    ])
  })

  test('a computed or fractional line number is ?SN', () => {
    expect(errorCodes('10 GOTO X')).toEqual(['SN@10'])
    expect(errorCodes('10 GOTO 1.5')).toEqual(['SN@10'])
    expect(errorCodes('10 GOSUB 1E2')).toEqual(['SN@10'])
  })

  test('RETURN, END, STOP and CLS stand alone', () => {
    expect(stmts('10 RETURN: END: STOP: CLS').map((s) => s.kind)).toEqual([
      'Return',
      'End',
      'Stop',
      'Cls',
    ])
  })
})

describe('arrays and data (Doc 01 §10 and §11)', () => {
  test('DIM declares one or more arrays', () => {
    const s = first('10 DIM A(10), B$(3, 3)')
    expect(
      s.kind === 'Dim' && s.arrays.map((a) => [a.name.canonical, a.bounds.map(sexpr)]),
    ).toEqual([
      ['A', ['10']],
      ['B$', ['3', '3']],
    ])
  })

  test('DIM needs bounds', () => {
    expect(errorCodes('10 DIM A')).toEqual(['SN@10'])
  })

  test('DATA items: numbers, quoted and unquoted strings, and empty items', () => {
    const s = first('10 DATA 1, -2.5, &HFF, "A,B", HELLO WORLD, , ""')
    expect(s.kind === 'Data' && s.items.map((i) => [i.kind, i.value])).toEqual([
      ['Number', 1],
      ['Number', -2.5],
      ['Number', 255],
      ['String', 'A,B'],
      ['String', 'HELLO WORLD'],
      ['String', ''],
      ['String', ''],
    ])
  })

  test('a DATA quote "" is a literal quote; text after a closing quote is ?SN', () => {
    const s = first('10 DATA "SAY ""HI"""')
    expect(s.kind === 'Data' && s.items[0]?.value).toBe('SAY "HI"')
    expect(errorCodes('10 DATA "A"B')).toEqual(['SN@10'])
  })

  test('DATA items are trimmed of tabs as well as spaces, like the rest of the source', () => {
    const s = first('10 DATA\t5,\tAPPLE PIE\t, "X"\t')
    expect(s.kind === 'Data' && s.items.map((i) => [i.kind, i.value])).toEqual([
      ['Number', 5],
      ['String', 'APPLE PIE'],
      ['String', 'X'],
    ])
  })

  test('an unquoted DATA item cannot contain a quote', () => {
    expect(errorCodes('10 DATA AB"C')).toEqual(['SN@10'])
  })

  test('a DATA number that is not finite is ?OV', () => {
    expect(errorCodes('10 DATA 1E400')).toEqual(['OV@10'])
  })

  test('DATA must be a top-level statement', () => {
    expect(errorCodes('10 IF X THEN DATA 1')).toEqual(['SN@10'])
  })

  test('READ and RESTORE', () => {
    const r = first('10 READ A, B$(1)')
    expect(r.kind === 'Read' && r.targets.map(sexpr)).toEqual(['A', '(index B$ 1)'])
    expect(first('10 RESTORE')).toMatchObject({ kind: 'Restore', target: null })
    expect(first('10 RESTORE 100')).toMatchObject({ target: { lineno: 100 } })
  })
})

describe('other statements', () => {
  test('RANDOMIZE with and without a seed', () => {
    expect(first('10 RANDOMIZE')).toMatchObject({ kind: 'Randomize', seed: null })
    const s = first('10 RANDOMIZE 42')
    expect(s.kind === 'Randomize' && s.seed && sexpr(s.seed)).toBe('42')
  })

  test('the MID$ statement', () => {
    const s = first('10 MID$(A$, 2, 3) = "XYZ"')
    expect(
      s.kind === 'MidAssign' && [sexpr(s.target), sexpr(s.start), s.length && sexpr(s.length)],
    ).toEqual(['A$', '2', '3'])
    expect(first('10 MID$(A$(1), 2) = "X"')).toMatchObject({ kind: 'MidAssign', length: null })
  })

  test('comments are statements and keep their text', () => {
    expect(stmts("10 PRINT 1 ' NOTE")).toMatchObject([
      { kind: 'Print' },
      { kind: 'Rem', style: 'apostrophe', text: ' NOTE' },
    ])
    expect(first('10 REM HELLO')).toMatchObject({ kind: 'Rem', style: 'rem', text: ' HELLO' })
  })

  test('a statement from a later phase is ?SN, with a message saying when it arrives', () => {
    expect(messages('10 WHILE X')).toEqual([expect.stringContaining('Phase 2')])
    expect(messages('10 LOCATE 1, 1')).toEqual([expect.stringContaining('Phase 5')])
    expect(messages('10 WAIT')).toEqual([expect.stringContaining('Phase 6')])
  })

  test('a keyword that cannot start a statement is ?SN', () => {
    expect(errorCodes('10 THEN 20')).toEqual(['SN@10'])
  })
})
