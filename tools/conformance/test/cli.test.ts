import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const cli = join(import.meta.dirname, '../src/cli.ts')

function conform(...args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
  return { code: result.status, out: result.stdout + result.stderr }
}

describe('pnpm conform [name]', () => {
  test('runs one example by name and exits 0 when it matches', () => {
    const { code, out } = conform('01-hello')
    expect(out).toContain('✓ 01-hello')
    expect(out).toContain('1 case passed')
    expect(code).toBe(0)
  })

  test('a name that matches nothing is an error', () => {
    const { code, out } = conform('no-such-example')
    expect(out).toContain('no example matches "no-such-example"')
    expect(code).toBe(1)
  })
})

describe('pnpm conform against another examples directory', () => {
  test('a transcript that differs fails with a unified diff and exit code 1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ignition-conform-'))
    try {
      mkdirSync(join(dir, '01-wrong'))
      writeFileSync(join(dir, '01-wrong/program.bas'), '10 PRINT "RIGHT"\n')
      writeFileSync(join(dir, '01-wrong/transcript.txt'), 'WRONG\n')
      const { code, out } = conform(`--examples=${dir}`)
      expect(out).toContain('✗ 01-wrong: the transcript differs')
      expect(out).toContain('-WRONG')
      expect(out).toContain('+RIGHT')
      expect(out).toContain('0 cases passed, 1 failed')
      expect(code).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
