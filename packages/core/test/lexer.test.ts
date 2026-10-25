import { describe, expect, test } from 'vitest'
import { lex } from '../src/lexer/lexer.ts'
import type { Token } from '../src/lexer/token.ts'

/** A compact, readable form of a token for assertions. */
function show(t: Token): string {
  switch (t.kind) {
    case 'lineno':
      return `ln:${t.value}`
    case 'number':
      return `num:${t.value}`
    case 'string':
      return `str:${t.value}`
    case 'ident':
      return `id:${t.canonical}`
    case 'keyword':
      return `kw:${t.keyword}`
    case 'op':
      return t.op
    case 'comment':
      return `${t.style}:${t.comment}`
    case 'data':
      return `data:${t.raw}`
    case 'eol':
      return 'eol'
    case 'eof':
      return 'eof'
  }
}

const tokens = (src: string) => lex(src).tokens.map(show)
const errors = (src: string) => lex(src).errors.map((e) => `${e.code}@${e.pos?.line}:${e.pos?.col}`)

describe('program lines (Doc 01 §2)', () => {
  test('a line is a line number followed by its tokens', () => {
    expect(tokens('10 PRINT "HI"; A$')).toEqual([
      'ln:10',
      'kw:PRINT',
      'str:HI',
      ';',
      'id:A$',
      'eol',
      'eof',
    ])
  })

  test('CRLF and CR both end a line, and blank lines are skipped', () => {
    expect(tokens('10 END\r\n\r\n20 END\r30 END')).toEqual([
      'ln:10',
      'kw:END',
      'eol',
      'ln:20',
      'kw:END',
      'eol',
      'ln:30',
      'kw:END',
      'eol',
      'eof',
    ])
  })

  test('leading zeros in a line number are ignored', () => {
    expect(tokens('010 END')[0]).toBe('ln:10')
  })

  test('indentation before the line number is allowed', () => {
    expect(tokens('   10 END')).toEqual(['ln:10', 'kw:END', 'eol', 'eof'])
  })

  test('a line without a line number is ?SN', () => {
    expect(errors('PRINT 1')).toEqual(['SN@1:1'])
  })

  test('line numbers above 65529 are ?SN', () => {
    expect(errors('65529 END')).toEqual([])
    expect(errors('65530 END')).toEqual(['SN@1:1'])
  })

  test('positions are 1-based source lines and columns', () => {
    const t = lex('\n10 LET A = 1').tokens
    expect(t[0]?.pos).toEqual({ line: 2, col: 1 })
    expect(t[1]?.pos).toEqual({ line: 2, col: 4 })
    expect(t[2]?.pos).toEqual({ line: 2, col: 8 })
  })
})

describe('words (Doc 01 §3)', () => {
  test('keywords and identifiers are case-insensitive; the display keeps the spelling', () => {
    const t = lex('10 print Total').tokens
    expect(t.map(show)).toEqual(['ln:10', 'kw:PRINT', 'id:TOTAL', 'eol', 'eof'])
    expect(t[2]).toMatchObject({ kind: 'ident', display: 'Total' })
  })

  test('words are read longest-first, so TOTAL, FORM and PRINTER are identifiers', () => {
    expect(tokens('10 TOTAL = FORM + PRINTER')).toEqual([
      'ln:10',
      'id:TOTAL',
      '=',
      'id:FORM',
      '+',
      'id:PRINTER',
      'eol',
      'eof',
    ])
  })

  test('crunched keywords run together into identifiers', () => {
    expect(tokens('10 FORI=1TO10')).toEqual([
      'ln:10',
      'id:FORI',
      '=',
      'num:1',
      'id:TO10',
      'eol',
      'eof',
    ])
  })

  test('$ and % belong to the name; # and ! are accepted and dropped', () => {
    expect(tokens('10 A$ A% A# A!').slice(1, 5)).toEqual(['id:A$', 'id:A%', 'id:A', 'id:A'])
  })

  test('a keyword spelled with $ is a keyword', () => {
    expect(tokens('10 X$ = LEFT$(A$, 2)').slice(3, 4)).toEqual(['kw:LEFT$'])
  })

  test('a reserved word is not a name, with or without a sigil', () => {
    expect(errors('10 LEFT = 1')).toEqual(['SN@1:4'])
    expect(errors('10 LEFT% = 1')).toEqual(['SN@1:4'])
    expect(errors('10 PRINT$ = 1')).toEqual(['SN@1:4'])
    expect(errors('10 WHILE$ = 1')).toEqual(['SN@1:4'])
  })

  test('words reserved for later phases are keywords now', () => {
    expect(tokens('10 LOCATE 1, 1').slice(1, 2)).toEqual(['kw:LOCATE'])
  })

  test('identifiers are ASCII; other letters are ?SN', () => {
    expect(errors('10 CAFÉ = 1')).toEqual(['SN@1:7'])
  })
})

describe('numbers (Doc 01 §3)', () => {
  test('decimal, exponent and hex forms', () => {
    expect(tokens('10 123 1.5 .5 5. 1E10 2.5e-3 &HFF &hff').slice(1, 9)).toEqual([
      'num:123',
      'num:1.5',
      'num:0.5',
      'num:5',
      'num:10000000000',
      'num:0.0025',
      'num:255',
      'num:255',
    ])
  })

  test('a literal has no sign: unary minus is an operator', () => {
    expect(tokens('10 -5').slice(1, 3)).toEqual(['-', 'num:5'])
  })

  test('an exponent needs digits, so 1E alone is 1 followed by a word', () => {
    expect(tokens('10 1E').slice(1, 3)).toEqual(['num:1', 'id:E'])
  })

  test('a literal that is not finite, or hex above 2^53 - 1, is ?OV', () => {
    expect(lex('10 X = 1E400').errors.map((e) => e.code)).toEqual(['OV'])
    expect(lex('10 X = &H20000000000000').errors.map((e) => e.code)).toEqual(['OV'])
    expect(lex('10 X = &H1FFFFFFFFFFFFF').errors).toEqual([])
  })

  test('a bare point or & is ?SN', () => {
    expect(errors('10 X = .')).toEqual(['SN@1:8'])
    expect(errors('10 X = &')).toEqual(['SN@1:8'])
  })
})

describe('strings (Doc 01 §3)', () => {
  test('"" inside a string is a literal quote', () => {
    expect(tokens('10 PRINT "SAY ""HI"""').slice(2, 3)).toEqual(['str:SAY "HI"'])
  })

  test('an unterminated string is ?SN', () => {
    expect(errors('10 PRINT "OOPS')).toEqual(['SN@1:10'])
  })
})

describe('operators', () => {
  test('one- and two-character operators', () => {
    expect(tokens('10 <> <= >= < > = + - * / \\ ^ ( ) , ; :').slice(1, -2)).toEqual([
      '<>',
      '<=',
      '>=',
      '<',
      '>',
      '=',
      '+',
      '-',
      '*',
      '/',
      '\\',
      '^',
      '(',
      ')',
      ',',
      ';',
      ':',
    ])
  })

  test('>< is two operators, not not-equal', () => {
    expect(tokens('10 ><').slice(1, 3)).toEqual(['>', '<'])
  })

  test('MOD is a keyword', () => {
    expect(tokens('10 A MOD B').slice(1, 4)).toEqual(['id:A', 'kw:MOD', 'id:B'])
  })

  test('an unexpected character is ?SN', () => {
    expect(errors('10 PRINT @')).toEqual(['SN@1:10'])
  })
})

describe('comments (Doc 01 §3)', () => {
  test("' starts a comment anywhere outside a string", () => {
    expect(tokens(`10 PRINT "A'B" ' NOTE`).slice(1)).toEqual([
      'kw:PRINT',
      "str:A'B",
      'apostrophe: NOTE',
      'eol',
      'eof',
    ])
  })

  test('REM starts a comment where a statement can start', () => {
    expect(tokens('10 REM HELLO: WORLD').slice(1, 2)).toEqual(['rem: HELLO: WORLD'])
    expect(tokens('10 X = 1: REM HI').slice(4, 6)).toEqual([':', 'rem: HI'])
    expect(tokens('10 IF X THEN REM HI ELSE 20').slice(3, 5)).toEqual([
      'kw:THEN',
      'rem: HI ELSE 20',
    ])
  })

  test('REMARK is an identifier, and REM elsewhere is just a keyword', () => {
    expect(tokens('10 REMARK = 1').slice(1, 2)).toEqual(['id:REMARK'])
    expect(tokens('10 PRINT REM').slice(1, 3)).toEqual(['kw:PRINT', 'kw:REM'])
  })
})

describe('DATA (Doc 01 §11)', () => {
  test('keeps its raw text up to a colon or apostrophe outside quotes', () => {
    expect(tokens(`10 DATA 1, "A:B", C: PRINT ' X`).slice(1)).toEqual([
      'kw:DATA',
      'data: 1, "A:B", C',
      ':',
      'kw:PRINT',
      'apostrophe: X',
      'eol',
      'eof',
    ])
  })

  test('runs to the end of the line otherwise', () => {
    expect(tokens('10 DATA HELLO WORLD').slice(1, 3)).toEqual(['kw:DATA', 'data: HELLO WORLD'])
  })
})
