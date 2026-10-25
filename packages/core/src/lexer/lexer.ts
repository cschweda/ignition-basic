import { scanNumeric } from '@ignition/rt-js'
import { compileError } from '../diagnostics/errors.ts'
import type { IgnitionError, Pos } from '../diagnostics/errors.ts'
import { IGNITION_KEYWORDS } from './keywords.ts'
import type { KeywordTable } from './keywords.ts'
import type { Op, Sigil, Token } from './token.ts'

export interface LexResult {
  tokens: Token[]
  errors: IgnitionError[]
}

/** The largest line number a program may use (Doc 01 §2). */
export const MAX_LINENO = 65529

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9'
const isLetter = (c: string | undefined): boolean => c !== undefined && /^[A-Za-z]$/.test(c)
const isWordChar = (c: string | undefined): boolean => c !== undefined && /^[A-Za-z0-9_]$/.test(c)
const isBlank = (c: string | undefined): boolean => c === ' ' || c === '\t'

const SINGLE_OPS: ReadonlySet<string> = new Set([
  '+',
  '-',
  '*',
  '/',
  '\\',
  '^',
  '=',
  '(',
  ')',
  ',',
  ';',
  ':',
])

/**
 * Turns source text into tokens (Doc 01 §2 and §3). Each program line becomes its line number,
 * its tokens and an `eol`; blank lines produce nothing. Errors are collected, not thrown, so the
 * IDE can list every one of them.
 */
export function lex(source: string, keywords: KeywordTable = IGNITION_KEYWORDS): LexResult {
  const tokens: Token[] = []
  const errors: IgnitionError[] = []
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  lines.forEach((text, index) => {
    if (/^[ \t]*$/.test(text)) return
    lexLine(text, index + 1, keywords, tokens, errors)
  })
  const last = lines.length
  tokens.push({
    kind: 'eof',
    pos: { line: last, col: (lines[last - 1]?.length ?? 0) + 1 },
    text: '',
  })
  return { tokens, errors }
}

function lexLine(
  text: string,
  line: number,
  keywords: KeywordTable,
  tokens: Token[],
  errors: IgnitionError[],
): void {
  const pos = (i: number): Pos => ({ line, col: i + 1 })
  let lineno: number | null = null
  const error = (code: 'SN' | 'OV', detail: string, i: number) =>
    errors.push(compileError(code, detail, pos(i), lineno))

  let i = 0
  while (isBlank(text[i])) i++
  if (!isDigit(text[i])) {
    error('SN', 'a program line must start with a line number', i)
    return
  }
  const numberStart = i
  while (isDigit(text[i])) i++
  const value = Number(text.slice(numberStart, i))
  if (value > MAX_LINENO) {
    error('SN', `line number ${text.slice(numberStart, i)} is above ${MAX_LINENO}`, numberStart)
    return
  }
  lineno = value
  tokens.push({ kind: 'lineno', value, pos: pos(numberStart), text: text.slice(numberStart, i) })

  // REM is a comment only where a statement can start: after the line number, a colon, THEN or ELSE.
  let statementStart = true
  for (;;) {
    while (isBlank(text[i])) i++
    if (i >= text.length) break
    const start = i
    const c = text[i]
    let next = false

    if (c === "'") {
      tokens.push({
        kind: 'comment',
        style: 'apostrophe',
        comment: text.slice(i + 1),
        pos: pos(i),
        text: text.slice(i),
      })
      i = text.length
    } else if (c === '"') {
      let value = ''
      let j = i + 1
      let closed = false
      while (j < text.length) {
        if (text[j] === '"') {
          if (text[j + 1] === '"') {
            value += '"'
            j += 2
            continue
          }
          closed = true
          j++
          break
        }
        value += text[j]
        j++
      }
      if (!closed) {
        error('SN', 'this string has no closing quote', start)
        i = text.length
      } else {
        tokens.push({ kind: 'string', value, pos: pos(start), text: text.slice(start, j) })
        i = j
      }
    } else if (isDigit(c) || c === '.' || c === '&') {
      const found = scanNumeric(text, i)
      if (found === null) {
        error('SN', `unexpected "${c}"`, start)
        i++
      } else {
        const raw = text.slice(start, found.end)
        if (found.outOfRange) {
          error('OV', `the number ${raw} is out of range`, start)
        }
        tokens.push({ kind: 'number', value: found.value, pos: pos(start), text: raw })
        i = found.end
      }
    } else if (isLetter(c)) {
      while (isWordChar(text[i])) i++
      const word = text.slice(start, i).toUpperCase()
      let sigilChar = ''
      if (text[i] === '$' || text[i] === '%' || text[i] === '#' || text[i] === '!') {
        sigilChar = text[i] ?? ''
        i++
      }
      const spelled = text.slice(start, i)
      const asKeyword = sigilChar === '$' ? `${word}$` : word
      if (keywords.keywords.has(asKeyword) && (sigilChar === '' || sigilChar === '$')) {
        if (asKeyword === 'REM' && statementStart) {
          tokens.push({
            kind: 'comment',
            style: 'rem',
            comment: text.slice(i),
            pos: pos(start),
            text: text.slice(start),
          })
          i = text.length
        } else {
          tokens.push({ kind: 'keyword', keyword: asKeyword, pos: pos(start), text: spelled })
          next = asKeyword === 'THEN' || asKeyword === 'ELSE'
          if (asKeyword === 'DATA') i = lexDataText(text, i, pos, tokens)
        }
      } else if (keywords.reserved.has(word)) {
        error('SN', `${word} is a reserved word and can't be used as a name`, start)
      } else {
        const sigil: Sigil = sigilChar === '$' || sigilChar === '%' ? sigilChar : ''
        tokens.push({
          kind: 'ident',
          canonical: word + sigil,
          display: spelled,
          sigil,
          pos: pos(start),
          text: spelled,
        })
      }
    } else if (c === '<' || c === '>') {
      const two = text.slice(i, i + 2)
      const op: Op = two === '<>' || two === '<=' || two === '>=' ? two : c
      tokens.push({ kind: 'op', op, pos: pos(start), text: op })
      i += op.length
    } else if (c !== undefined && SINGLE_OPS.has(c)) {
      tokens.push({ kind: 'op', op: c as Op, pos: pos(start), text: c })
      i++
      next = c === ':'
    } else {
      const ch = String.fromCodePoint(text.codePointAt(i) ?? 0)
      error('SN', `unexpected "${ch}"`, start)
      i += ch.length
    }
    statementStart = next
  }
  tokens.push({ kind: 'eol', pos: pos(text.length), text: '' })
}

/**
 * After DATA, everything up to a `:` or `'` outside quotes, or the end of the line, is one raw
 * token; the parser splits it into items (Doc 01 §11). Returns the index where lexing resumes.
 */
function lexDataText(
  text: string,
  start: number,
  pos: (i: number) => Pos,
  tokens: Token[],
): number {
  let i = start
  let quoted = false
  while (i < text.length) {
    const c = text[i]
    if (c === '"') quoted = !quoted
    else if (!quoted && (c === ':' || c === "'")) break
    i++
  }
  tokens.push({
    kind: 'data',
    raw: text.slice(start, i),
    pos: pos(start),
    text: text.slice(start, i),
  })
  return i
}
