import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { analyze, parse } from '@ignition/core'

const examplesDir = join(import.meta.dirname, '../../../packages/examples')
const names = readdirSync(examplesDir)
  .filter((n) => /^\d\d-/.test(n))
  .sort()

describe('the example programs', () => {
  test('there are ten of them', () => {
    expect(names).toHaveLength(10)
  })

  test.each(names)('%s parses without errors', (name) => {
    expect(parse(source(name)).errors).toEqual([])
  })

  test.each(names)('%s passes the semantic pass without errors', (name) => {
    expect(analyze(parse(source(name)).program).errors).toEqual([])
  })

  test('only 08-arrays has an implicit DIM, and its Index warns about SCORES alone', () => {
    const warnings = names.flatMap((name) =>
      analyze(parse(source(name)).program).index.warnings.map(
        (w) => `${name}:${w.lineno}:${w.code}`,
      ),
    )
    expect(warnings).toEqual(['08-arrays:210:IMPLICIT_DIM'])
  })
})

function source(name: string): string {
  return readFileSync(join(examplesDir, name, 'program.bas'), 'utf8')
}
