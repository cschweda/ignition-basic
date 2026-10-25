import type { Pos } from '../diagnostics/errors.ts'

export type Op =
  | '+'
  | '-'
  | '*'
  | '/'
  | '\\'
  | '^'
  | '='
  | '<>'
  | '<'
  | '>'
  | '<='
  | '>='
  | '('
  | ')'
  | ','
  | ';'
  | ':'

/** A type sigil that means something: `$` (string) or `%` (integer). `#` and `!` are dropped. */
export type Sigil = '' | '$' | '%'

interface At {
  pos: Pos
  /** The exact source text of the token. */
  text: string
}

export type Token =
  | (At & { kind: 'lineno'; value: number })
  | (At & { kind: 'number'; value: number })
  | (At & { kind: 'string'; value: string })
  | (At & {
      kind: 'ident'
      /** Upper case, with the sigil if it is `$` or `%`: the variable's identity. */
      canonical: string
      /** The spelling as written, sigil included. */
      display: string
      sigil: Sigil
    })
  | (At & { kind: 'keyword'; keyword: string })
  | (At & { kind: 'op'; op: Op })
  | (At & { kind: 'comment'; style: 'rem' | 'apostrophe'; comment: string })
  /** Everything after DATA up to a `:` or `'` outside quotes, or the end of the line. */
  | (At & { kind: 'data'; raw: string })
  | (At & { kind: 'eol' })
  | (At & { kind: 'eof' })
