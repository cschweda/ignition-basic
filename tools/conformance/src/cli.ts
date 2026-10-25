/**
 * `pnpm conform [name] [--examples=<dir>]`: runs every example case (or those whose name contains
 * `name`) through the interpreter and compares each transcript with its golden file (Doc 01 §18).
 * Exits non-zero on any failure. `--examples` points at another examples directory.
 */
import { join } from 'node:path'
import { findCases } from './cases.ts'
import type { Case } from './cases.ts'
import { unifiedDiff } from './diff.ts'
import { runCase } from './run.ts'

const args = process.argv.slice(2)
const examplesOption = args.find((a) => a.startsWith('--examples='))
const examplesDir = examplesOption
  ? examplesOption.slice('--examples='.length)
  : join(import.meta.dirname, '../../../packages/examples')
const filter = args.find((a) => !a.startsWith('--'))

const label = (c: Case): string => (c.name === 'default' ? c.example : `${c.example}/${c.name}`)

const { cases, problems } = findCases(examplesDir)
const selected = filter === undefined ? cases : cases.filter((c) => label(c).includes(filter))

let passed = 0
let failed = 0
if (filter !== undefined && selected.length === 0) {
  console.error(`no example matches "${filter}"`)
  failed++
}

for (const c of selected) {
  const result = runCase(c.source, c.inputLines)
  const transcriptFile = c.name === 'default' ? 'transcript.txt' : `${c.name}.transcript.txt`
  if (result.failure !== null) {
    failed++
    console.log(`✗ ${label(c)}: ${result.failure}`)
  } else if (result.output !== c.transcript) {
    failed++
    console.log(`✗ ${label(c)}: the transcript differs`)
    console.log(
      unifiedDiff(c.transcript, result.output, `${c.example}/${transcriptFile}`, 'interpreter'),
    )
  } else {
    passed++
    console.log(`✓ ${label(c)}`)
  }
}

for (const problem of problems) console.error(`✗ ${problem}`)

const summary = `${passed} case${passed === 1 ? '' : 's'} passed`
console.log(failed > 0 ? `${summary}, ${failed} failed` : summary)
if (failed > 0 || problems.length > 0) process.exitCode = 1
