import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { parse } from '@ignition/core'

const examplesDir = join(import.meta.dirname, '../../../packages/examples')
const names = readdirSync(examplesDir)
  .filter((n) => /^\d\d-/.test(n))
  .sort()

describe('the example programs', () => {
  test('there are ten of them', () => {
    expect(names).toHaveLength(10)
  })

  test.each(names)('%s parses without errors', (name) => {
    const source = readFileSync(join(examplesDir, name, 'program.bas'), 'utf8')
    expect(parse(source).errors).toEqual([])
  })
})
