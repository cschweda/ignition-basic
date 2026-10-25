import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { findCases } from '../src/cases.ts'

const examplesDir = join(import.meta.dirname, '../../../packages/examples')

describe('findCases on the real examples', () => {
  const { cases, problems } = findCases(examplesDir)

  test('finds every case with no problems', () => {
    expect(problems).toEqual([])
    expect(new Set(cases.map((c) => c.example)).size).toBe(10)
  })

  test('a default case is transcript.txt, with input.txt when the program reads input', () => {
    const guess = cases.find((c) => c.example === '02-guess')
    expect(guess).toMatchObject({ name: 'default', inputLines: ['50', 'abc', '25', '41'] })
    const hello = cases.find((c) => c.example === '01-hello')
    expect(hello?.inputLines).toEqual([])
  })

  test('named cases come from <case>.transcript.txt and <case>.input.txt', () => {
    const errors = cases.filter((c) => c.example === '10-errors').map((c) => c.name)
    expect(errors).toHaveLength(10)
    expect(errors).toContain('div-zero')
    const divZero = cases.find((c) => c.name === 'div-zero')
    expect(divZero?.inputLines).toEqual(['1'])
  })
})

describe('findCases reports layout problems', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function layout(files: Record<string, string>): string {
    dir = mkdtempSync(join(tmpdir(), 'ignition-cases-'))
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(dir, path, '..'), { recursive: true })
      writeFileSync(join(dir, path), text)
    }
    return dir
  }

  test('an example with no cases', () => {
    const { problems } = findCases(layout({ '01-a/program.bas': '10 END\n' }))
    expect(problems).toEqual(['01-a: no transcript.txt or <case>.transcript.txt'])
  })

  test('an input file with no transcript', () => {
    const { problems } = findCases(
      layout({
        '01-a/program.bas': '10 END\n',
        '01-a/transcript.txt': '\n',
        '01-a/extra.input.txt': '1\n',
      }),
    )
    expect(problems).toEqual(['01-a: extra.input.txt has no matching transcript'])
  })

  test('a golden that does not end with exactly one line break', () => {
    const { problems } = findCases(
      layout({
        '01-a/program.bas': '10 END\n',
        '01-a/transcript.txt': 'X',
        '01-a/two.transcript.txt': 'X\n\n',
      }),
    )
    expect(problems).toEqual([
      '01-a: transcript.txt must end with exactly one line break',
      '01-a: two.transcript.txt must end with exactly one line break',
    ])
  })

  test('a golden with carriage returns, as a CRLF checkout would have', () => {
    const { problems } = findCases(
      layout({ '01-a/program.bas': '10 END\n', '01-a/transcript.txt': 'X\r\n' }),
    )
    expect(problems).toEqual([
      '01-a: transcript.txt has carriage returns; goldens use LF line endings (see .gitattributes)',
    ])
  })

  test('a directory with no program.bas', () => {
    const { problems } = findCases(layout({ '01-a/transcript.txt': '\n' }))
    expect(problems).toEqual(['01-a: no program.bas'])
  })
})
