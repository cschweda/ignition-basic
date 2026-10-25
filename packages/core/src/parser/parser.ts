import { parseCompleteNumeric } from '@ignition/rt-js'
import type {
  BinaryOp,
  Branch,
  DataItem,
  DimArray,
  Expr,
  If,
  Line,
  LineRef,
  PrintItem,
  Program,
  Stmt,
  Target,
  VarRef,
} from '../ast/ast.ts'
import { compileError } from '../diagnostics/errors.ts'
import type { IgnitionError, Pos } from '../diagnostics/errors.ts'
import { IGNITION_KEYWORDS, laterPhaseOf } from '../lexer/keywords.ts'
import type { KeywordTable } from '../lexer/keywords.ts'
import { lex } from '../lexer/lexer.ts'
import type { Op, Token } from '../lexer/token.ts'

export interface ParseResult {
  program: Program
  errors: IgnitionError[]
}

/** The built-in functions of Phase 1 that take arguments in parentheses (Doc 01 §12). */
const FUNCTIONS: ReadonlySet<string> = new Set([
  'ABS',
  'SGN',
  'INT',
  'FIX',
  'SQR',
  'SIN',
  'COS',
  'TAN',
  'ATN',
  'EXP',
  'LOG',
  'RND',
  'ROUND',
  'MIN',
  'MAX',
  'LEN',
  'LEFT$',
  'RIGHT$',
  'MID$',
  'INSTR',
  'STR$',
  'VAL',
  'CHR$',
  'ASC',
  'UCASE$',
  'LCASE$',
  'TRIM$',
  'STRING$',
  'SPACE$',
])

const RELATIONAL: ReadonlySet<string> = new Set(['=', '<>', '<', '>', '<=', '>='])

/** Aborts the current line; `parse` turns it into an IgnitionError and moves to the next line. */
class LineFault {
  readonly code: 'SN' | 'OV'
  readonly detail: string
  readonly pos: Pos

  constructor(code: 'SN' | 'OV', detail: string, pos: Pos) {
    this.code = code
    this.detail = detail
    this.pos = pos
  }
}

/**
 * Parses a program (Master Design §2.7, refined by Doc 01). A line with a syntax error is reported
 * and kept with no statements, so jumps to it don't add errors of their own; parsing goes on with
 * the next line.
 */
export function parse(source: string, keywords: KeywordTable = IGNITION_KEYWORDS): ParseResult {
  const { tokens, errors } = lex(source, keywords)
  const lexedBadly = new Set(errors.map((e) => e.pos?.line))
  const lines: Line[] = []
  let previous: number | null = null

  let i = 0
  while (i < tokens.length) {
    const start = tokens[i]
    if (start === undefined || start.kind === 'eof') break
    let end = i
    while (tokens[end] !== undefined && tokens[end]?.kind !== 'eol') end++
    const lineTokens = tokens.slice(i, end + 1)
    i = end + 1
    if (start.kind !== 'lineno') continue

    const lineno = start.value
    if (previous !== null && lineno <= previous) {
      const detail =
        lineno === previous
          ? `line ${lineno} appears twice`
          : `line ${lineno} comes after line ${previous}; line numbers must increase`
      errors.push(compileError('SN', detail, start.pos, lineno))
    }
    previous = lineno

    const line: Line = { lineno, pos: start.pos, statements: [] }
    lines.push(line)
    if (lexedBadly.has(start.pos.line)) continue
    try {
      line.statements = new LineParser(lineTokens, lineno).parseLine()
    } catch (e) {
      if (!(e instanceof LineFault)) throw e
      errors.push(compileError(e.code, e.detail, e.pos, lineno))
    }
  }

  errors.sort(
    (a, b) => (a.pos?.line ?? 0) - (b.pos?.line ?? 0) || (a.pos?.col ?? 0) - (b.pos?.col ?? 0),
  )
  return { program: { lines }, errors }
}

/** Parses the tokens of one program line: its line number, statements and `eol`. */
class LineParser {
  readonly #tokens: Token[]
  readonly #lineno: number
  #i = 1 // past the line number

  constructor(tokens: Token[], lineno: number) {
    this.#tokens = tokens
    this.#lineno = lineno
  }

  parseLine(): Stmt[] {
    const stmts = this.#statementList(false)
    const t = this.#peek()
    if (this.#isKeyword(t, 'ELSE')) this.#fail('this ELSE has no IF to belong to', t)
    if (t.kind !== 'eol') this.#fail(`unexpected ${describe(t)}`, t)
    return stmts
  }

  // --------------------------------------------------------------------------- token helpers

  #peek(offset = 0): Token {
    const t = this.#tokens[this.#i + offset] ?? this.#tokens[this.#tokens.length - 1]
    if (t === undefined) throw new Error('a line has no tokens')
    return t
  }

  #next(): Token {
    const t = this.#peek()
    if (t.kind !== 'eol') this.#i++
    return t
  }

  #isOp(t: Token, op: Op): boolean {
    return t.kind === 'op' && t.op === op
  }

  #isKeyword(t: Token, keyword: string): boolean {
    return t.kind === 'keyword' && t.keyword === keyword
  }

  #expectOp(op: Op, what: string): Token {
    const t = this.#peek()
    if (!this.#isOp(t, op)) this.#fail(`expected ${what}, found ${describe(t)}`, t)
    return this.#next()
  }

  #expectKeyword(keyword: string): Token {
    const t = this.#peek()
    if (!this.#isKeyword(t, keyword)) this.#fail(`expected ${keyword}, found ${describe(t)}`, t)
    return this.#next()
  }

  #fail(detail: string, at: Token, code: 'SN' | 'OV' = 'SN'): never {
    throw new LineFault(code, detail, at.pos)
  }

  /** A statement ends at `:`, a comment, the end of the line, or an ELSE. */
  #atStatementEnd(): boolean {
    const t = this.#peek()
    return (
      t.kind === 'eol' || t.kind === 'comment' || this.#isOp(t, ':') || this.#isKeyword(t, 'ELSE')
    )
  }

  // --------------------------------------------------------------------------- statements

  /**
   * Statements separated by colons, up to the end of the line, or up to an ELSE when inside an IF
   * branch. A comment runs to the end of the line, so it is always the last statement.
   */
  #statementList(inBranch: boolean): Stmt[] {
    const stmts: Stmt[] = []
    for (;;) {
      while (this.#isOp(this.#peek(), ':')) this.#next()
      const t = this.#peek()
      if (t.kind === 'eol') break
      if (this.#isKeyword(t, 'ELSE')) {
        if (inBranch) break
        this.#fail('this ELSE has no IF to belong to', t)
      }
      if (t.kind === 'comment') {
        this.#next()
        stmts.push({
          kind: 'Rem',
          style: t.style,
          text: t.comment,
          pos: t.pos,
          lineno: this.#lineno,
        })
        break
      }
      stmts.push(this.#statement(inBranch))
      const after = this.#peek()
      if (!this.#atStatementEnd())
        this.#fail(`expected : or the end of the line, found ${describe(after)}`, after)
    }
    return stmts
  }

  #statement(inBranch: boolean): Stmt {
    const t = this.#peek()
    const at = { pos: t.pos, lineno: this.#lineno }
    if (t.kind === 'ident') {
      const target = this.#target()
      this.#expectOp('=', '=')
      return { kind: 'Let', target, value: this.#expression(), keyword: false, ...at }
    }
    if (t.kind !== 'keyword') this.#fail(`a statement can't start with ${describe(t)}`, t)
    this.#next()
    switch (t.keyword) {
      case 'LET': {
        const target = this.#target()
        this.#expectOp('=', '=')
        return { kind: 'Let', target, value: this.#expression(), keyword: true, ...at }
      }
      case 'PRINT':
        return { kind: 'Print', items: this.#printItems(), ...at }
      case 'INPUT':
        return this.#input(at)
      case 'IF':
        return this.#if(at)
      case 'FOR': {
        const variable = this.#simpleVariable('the FOR variable')
        this.#expectOp('=', '=')
        const from = this.#expression()
        this.#expectKeyword('TO')
        const to = this.#expression()
        let step: Expr | null = null
        if (this.#isKeyword(this.#peek(), 'STEP')) {
          this.#next()
          step = this.#expression()
        }
        return { kind: 'For', variable, from, to, step, ...at }
      }
      case 'NEXT': {
        const variables: VarRef[] = []
        if (!this.#atStatementEnd()) {
          variables.push(this.#simpleVariable('a NEXT variable'))
          while (this.#isOp(this.#peek(), ',')) {
            this.#next()
            variables.push(this.#simpleVariable('a NEXT variable'))
          }
        }
        return { kind: 'Next', variables, ...at }
      }
      case 'GOTO':
        return { kind: 'Goto', target: this.#lineRef('GOTO'), ...at }
      case 'GOSUB':
        return { kind: 'Gosub', target: this.#lineRef('GOSUB'), ...at }
      case 'RETURN':
        return { kind: 'Return', ...at }
      case 'ON': {
        const selector = this.#expression()
        const modeToken = this.#peek()
        if (!this.#isKeyword(modeToken, 'GOTO') && !this.#isKeyword(modeToken, 'GOSUB')) {
          this.#fail(`expected GOTO or GOSUB, found ${describe(modeToken)}`, modeToken)
        }
        this.#next()
        const mode = this.#isKeyword(modeToken, 'GOTO') ? 'GOTO' : 'GOSUB'
        const targets = [this.#lineRef(mode)]
        while (this.#isOp(this.#peek(), ',')) {
          this.#next()
          targets.push(this.#lineRef(mode))
        }
        return { kind: 'On', selector, mode, targets, ...at }
      }
      case 'DIM': {
        const arrays: DimArray[] = [this.#dimArray()]
        while (this.#isOp(this.#peek(), ',')) {
          this.#next()
          arrays.push(this.#dimArray())
        }
        return { kind: 'Dim', arrays, ...at }
      }
      case 'DATA': {
        if (inBranch) this.#fail('DATA must be a statement of its own, not part of an IF', t)
        const raw = this.#next()
        if (raw.kind !== 'data') throw new Error('the lexer always follows DATA with its text')
        return { kind: 'Data', items: this.#dataItems(raw.raw, raw.pos), ...at }
      }
      case 'READ':
        return { kind: 'Read', targets: this.#targetList(), ...at }
      case 'RESTORE':
        return {
          kind: 'Restore',
          target: this.#atStatementEnd() ? null : this.#lineRef('RESTORE'),
          ...at,
        }
      case 'END':
        return { kind: 'End', ...at }
      case 'STOP':
        return { kind: 'Stop', ...at }
      case 'CLS':
        return { kind: 'Cls', ...at }
      case 'RANDOMIZE':
        return {
          kind: 'Randomize',
          seed: this.#atStatementEnd() ? null : this.#expression(),
          ...at,
        }
      case 'MID$': {
        this.#expectOp('(', '( after MID$')
        const target = this.#target()
        this.#expectOp(',', ', after the MID$ variable')
        const start = this.#expression()
        let length: Expr | null = null
        if (this.#isOp(this.#peek(), ',')) {
          this.#next()
          length = this.#expression()
        }
        this.#expectOp(')', ')')
        this.#expectOp('=', '=')
        return { kind: 'MidAssign', target, start, length, value: this.#expression(), ...at }
      }
      default: {
        const phase = laterPhaseOf(t.keyword)
        if (phase !== null) this.#fail(`${t.keyword} arrives in Phase ${phase}`, t)
        return this.#fail(`a statement can't start with ${t.keyword}`, t)
      }
    }
  }

  #input(at: { pos: Pos; lineno: number }): Stmt {
    let prompt: { text: string; separator: ';' | ',' } | null = null
    const t = this.#peek()
    if (t.kind === 'string') {
      this.#next()
      const sep = this.#peek()
      if (!this.#isOp(sep, ';') && !this.#isOp(sep, ',')) {
        this.#fail(`the INPUT prompt must be followed by ; or ,`, sep)
      }
      this.#next()
      prompt = { text: t.value, separator: this.#isOp(sep, ';') ? ';' : ',' }
    }
    return { kind: 'Input', prompt, targets: this.#targetList(), ...at }
  }

  #if(at: { pos: Pos; lineno: number }): If {
    const cond = this.#expression()
    const t = this.#peek()
    if (this.#isKeyword(t, 'GOTO')) this.#fail('IF … GOTO is not supported; write IF … THEN n', t)
    this.#expectKeyword('THEN')
    const then = this.#branch('THEN')
    let otherwise: Branch | null = null
    if (this.#isKeyword(this.#peek(), 'ELSE')) {
      this.#next()
      otherwise = this.#branch('ELSE')
    }
    return { kind: 'If', cond, then, else: otherwise, ...at }
  }

  /** THEN or ELSE is followed by a line number or by statements (Doc 01 §9). */
  #branch(keyword: 'THEN' | 'ELSE'): Branch {
    const t = this.#peek()
    if (t.kind === 'number') {
      const target = this.#lineRef(keyword)
      const after = this.#peek()
      if (after.kind !== 'eol' && after.kind !== 'comment' && !this.#isKeyword(after, 'ELSE')) {
        this.#fail(
          `after ${keyword} ${target.lineno}, only ELSE or the end of the line may follow`,
          after,
        )
      }
      return { kind: 'Line', target }
    }
    const stmts = this.#statementList(true)
    if (stmts.length === 0) this.#fail(`${keyword} needs a line number or a statement`, t)
    return { kind: 'Stmts', stmts }
  }

  #printItems(): PrintItem[] {
    const items: PrintItem[] = []
    let afterValue = false
    while (!this.#atStatementEnd()) {
      const t = this.#peek()
      if (this.#isOp(t, ';') || this.#isOp(t, ',')) {
        this.#next()
        items.push({ kind: this.#isOp(t, ';') ? 'Semicolon' : 'Comma', pos: t.pos })
        afterValue = false
        continue
      }
      if (afterValue) this.#fail('PRINT items need a ; or , between them', t)
      if (this.#isKeyword(t, 'TAB')) {
        this.#next()
        this.#expectOp('(', '( after TAB')
        const arg = this.#expression()
        this.#expectOp(')', ')')
        items.push({ kind: 'Tab', pos: t.pos, arg })
      } else {
        items.push({ kind: 'Expr', expr: this.#expression() })
      }
      afterValue = true
    }
    return items
  }

  #dimArray(): DimArray {
    const t = this.#peek()
    if (t.kind !== 'ident') this.#fail(`expected an array name, found ${describe(t)}`, t)
    this.#next()
    if (!this.#isOp(this.#peek(), '('))
      this.#fail(`DIM ${t.display} needs bounds in parentheses`, this.#peek())
    return { pos: t.pos, name: nameOf(t), bounds: this.#parenthesizedList() }
  }

  /**
   * Splits DATA's raw text into items (Doc 01 §11): quoted strings ("" is a quote), numeric
   * literals with an optional sign, unquoted strings, and empty items.
   */
  #dataItems(raw: string, at: Pos): DataItem[] {
    const items: DataItem[] = []
    const posOf = (i: number): Pos => ({ line: at.line, col: at.col + i })
    let i = 0
    for (;;) {
      while (raw[i] === ' ') i++
      if (raw[i] === '"') {
        const start = i
        let value = ''
        let j = i + 1
        for (;;) {
          if (j >= raw.length)
            throw new LineFault('SN', 'this DATA string has no closing quote', posOf(start))
          if (raw[j] === '"') {
            if (raw[j + 1] === '"') {
              value += '"'
              j += 2
              continue
            }
            j++
            break
          }
          value += raw[j]
          j++
        }
        while (raw[j] === ' ') j++
        if (j < raw.length && raw[j] !== ',') {
          throw new LineFault('SN', 'only a comma may follow a quoted DATA item', posOf(j))
        }
        items.push({ kind: 'String', pos: posOf(start), value, quoted: true })
        i = j
      } else {
        const comma = raw.indexOf(',', i)
        const end = comma === -1 ? raw.length : comma
        const text = raw.slice(i, end).replace(/ +$/, '')
        if (text.includes('"')) {
          throw new LineFault(
            'SN',
            `an unquoted DATA item can't contain a quote: ${text}`,
            posOf(i),
          )
        }
        const number = text === '' ? null : parseCompleteNumeric(text)
        if (number === null) {
          items.push({ kind: 'String', pos: posOf(i), value: text, quoted: false })
        } else if (number.outOfRange) {
          throw new LineFault('OV', `the DATA number ${text} is out of range`, posOf(i))
        } else {
          items.push({ kind: 'Number', pos: posOf(i), value: number.value, raw: text })
        }
        i = end
      }
      if (i >= raw.length) return items
      i++ // past the comma; a trailing comma leaves one more, empty, item
    }
  }

  // --------------------------------------------------------------------------- pieces

  #lineRef(after: string): LineRef {
    const t = this.#peek()
    if (t.kind !== 'number' || !/^\d+$/.test(t.text)) {
      this.#fail(`${after} needs a line number, found ${describe(t)}`, t)
    }
    this.#next()
    return { lineno: t.value, pos: t.pos }
  }

  #simpleVariable(what: string): VarRef {
    const t = this.#peek()
    if (t.kind !== 'ident') this.#fail(`${what} must be a variable, found ${describe(t)}`, t)
    this.#next()
    if (this.#isOp(this.#peek(), '('))
      this.#fail(`${what} must be a simple variable, not an array element`, t)
    return { kind: 'Var', pos: t.pos, name: nameOf(t) }
  }

  #target(): Target {
    const t = this.#peek()
    if (t.kind !== 'ident') this.#fail(`expected a variable, found ${describe(t)}`, t)
    this.#next()
    if (this.#isOp(this.#peek(), '(')) {
      return { kind: 'Index', pos: t.pos, name: nameOf(t), indices: this.#parenthesizedList() }
    }
    return { kind: 'Var', pos: t.pos, name: nameOf(t) }
  }

  #targetList(): Target[] {
    const targets = [this.#target()]
    while (this.#isOp(this.#peek(), ',')) {
      this.#next()
      targets.push(this.#target())
    }
    return targets
  }

  /** `( expr [, expr …] )` */
  #parenthesizedList(): Expr[] {
    this.#expectOp('(', '(')
    const list = [this.#expression()]
    while (this.#isOp(this.#peek(), ',')) {
      this.#next()
      list.push(this.#expression())
    }
    this.#expectOp(')', ')')
    return list
  }

  // --------------------------------------------------------------------------- expressions

  /** Precedence, loosest first: OR, AND, NOT, comparisons, + -, * / \ MOD, unary - +, ^. */
  #expression(): Expr {
    let left = this.#and()
    while (this.#isKeyword(this.#peek(), 'OR')) {
      const op = this.#next()
      left = { kind: 'Binary', op: 'OR', left, right: this.#and(), pos: op.pos }
    }
    return left
  }

  #and(): Expr {
    let left = this.#not()
    while (this.#isKeyword(this.#peek(), 'AND')) {
      const op = this.#next()
      left = { kind: 'Binary', op: 'AND', left, right: this.#not(), pos: op.pos }
    }
    return left
  }

  #not(): Expr {
    const t = this.#peek()
    if (this.#isKeyword(t, 'NOT')) {
      this.#next()
      return { kind: 'Unary', op: 'NOT', operand: this.#not(), pos: t.pos }
    }
    return this.#comparison()
  }

  #comparison(): Expr {
    const left = this.#additive()
    const t = this.#peek()
    if (t.kind !== 'op' || !RELATIONAL.has(t.op)) return left
    this.#next()
    const node: Expr = {
      kind: 'Binary',
      op: t.op as BinaryOp,
      left,
      right: this.#additive(),
      pos: t.pos,
    }
    const again = this.#peek()
    if (again.kind === 'op' && RELATIONAL.has(again.op)) {
      this.#fail("comparisons can't be chained; join them with AND", again)
    }
    return node
  }

  #additive(): Expr {
    let left = this.#multiplicative()
    for (;;) {
      const t = this.#peek()
      if (!this.#isOp(t, '+') && !this.#isOp(t, '-')) return left
      this.#next()
      const op: BinaryOp = this.#isOp(t, '+') ? '+' : '-'
      left = { kind: 'Binary', op, left, right: this.#multiplicative(), pos: t.pos }
    }
  }

  #multiplicative(): Expr {
    let left = this.#unary()
    for (;;) {
      const t = this.#peek()
      let op: BinaryOp
      if (this.#isOp(t, '*')) op = '*'
      else if (this.#isOp(t, '/')) op = '/'
      else if (this.#isOp(t, '\\')) op = '\\'
      else if (this.#isKeyword(t, 'MOD')) op = 'MOD'
      else return left
      this.#next()
      left = { kind: 'Binary', op, left, right: this.#unary(), pos: t.pos }
    }
  }

  #unary(): Expr {
    const t = this.#peek()
    if (this.#isOp(t, '-') || this.#isOp(t, '+')) {
      this.#next()
      return {
        kind: 'Unary',
        op: this.#isOp(t, '-') ? '-' : '+',
        operand: this.#unary(),
        pos: t.pos,
      }
    }
    return this.#power()
  }

  /** `^` is right-associative, and its exponent may carry a sign: `2 ^ -1`. */
  #power(): Expr {
    const base = this.#primary()
    const t = this.#peek()
    if (!this.#isOp(t, '^')) return base
    this.#next()
    return { kind: 'Binary', op: '^', left: base, right: this.#unary(), pos: t.pos }
  }

  #primary(): Expr {
    const t = this.#peek()
    switch (t.kind) {
      case 'number':
        this.#next()
        return { kind: 'Number', value: t.value, raw: t.text, pos: t.pos }
      case 'string':
        this.#next()
        return { kind: 'String', value: t.value, pos: t.pos }
      case 'ident': {
        this.#next()
        if (this.#isOp(this.#peek(), '(')) {
          return { kind: 'Index', pos: t.pos, name: nameOf(t), indices: this.#parenthesizedList() }
        }
        return { kind: 'Var', pos: t.pos, name: nameOf(t) }
      }
      case 'op':
        if (t.op === '(') {
          this.#next()
          const expr = this.#expression()
          this.#expectOp(')', ')')
          return { kind: 'Paren', expr, pos: t.pos }
        }
        break
      case 'keyword': {
        const k = t.keyword
        if (k === 'TIMER') {
          this.#next()
          if (this.#isOp(this.#peek(), '(')) this.#fail('TIMER takes no parentheses', this.#peek())
          return { kind: 'Call', fn: 'TIMER', args: [], pos: t.pos }
        }
        if (k === 'TAB') this.#fail('TAB is only allowed as a PRINT item', t)
        if (FUNCTIONS.has(k)) {
          this.#next()
          if (!this.#isOp(this.#peek(), '('))
            this.#fail(`${k} needs its arguments in parentheses`, this.#peek())
          return { kind: 'Call', fn: k, args: this.#parenthesizedList(), pos: t.pos }
        }
        const phase = laterPhaseOf(k)
        if (phase !== null) this.#fail(`${k} arrives in Phase ${phase}`, t)
        break
      }
      default:
        break
    }
    return this.#fail(`expected a value, found ${describe(t)}`, t)
  }
}

function nameOf(t: Token & { kind: 'ident' }) {
  return { canonical: t.canonical, display: t.display, sigil: t.sigil }
}

/** How a token reads in an error message. */
function describe(t: Token): string {
  switch (t.kind) {
    case 'eol':
    case 'eof':
      return 'the end of the line'
    case 'keyword':
      return t.keyword
    case 'string':
      return `"${t.value}"`
    case 'comment':
      return 'a comment'
    default:
      return t.text
  }
}
