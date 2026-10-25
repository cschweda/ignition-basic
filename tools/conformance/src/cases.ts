import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** One run of one example: its program, the scripted input and the expected transcript. */
export interface Case {
  /** The example's directory name, e.g. `02-guess`. */
  example: string
  /** `default`, or the name before `.transcript.txt`. */
  name: string
  source: string
  /** One line per INPUT request (Doc 01 §18). */
  inputLines: string[]
  transcript: string
}

/** Reads an input file as one line per request; a final line break doesn't add an empty line. */
function readInput(path: string): string[] {
  if (!existsSync(path)) return []
  const text = readFileSync(path, 'utf8').replace(/\r\n?/g, '\n')
  const list = text.split('\n')
  if (list.at(-1) === '') list.pop()
  return list
}

/**
 * Finds every example case under `dir` (Doc 01 §18): each `NN-name/` holds `program.bas`, plus
 * `transcript.txt` (and `input.txt`) for the default case and `<case>.transcript.txt` (and
 * `<case>.input.txt`) for named cases. Layout mistakes come back as problems.
 */
export function findCases(dir: string): { cases: Case[]; problems: string[] } {
  const cases: Case[] = []
  const problems: string[] = []
  const examples = readdirSync(dir)
    .filter((name) => /^\d\d-/.test(name) && statSync(join(dir, name)).isDirectory())
    .sort()

  for (const example of examples) {
    const folder = join(dir, example)
    const programPath = join(folder, 'program.bas')
    if (!existsSync(programPath)) {
      problems.push(`${example}: no program.bas`)
      continue
    }
    const source = readFileSync(programPath, 'utf8')
    const files = readdirSync(folder)
    const names = files
      .filter((f) => f === 'transcript.txt' || f.endsWith('.transcript.txt'))
      .map((f) => (f === 'transcript.txt' ? 'default' : f.slice(0, -'.transcript.txt'.length)))
      .sort((x, y) => (x === 'default' ? -1 : y === 'default' ? 1 : x.localeCompare(y)))
    if (names.length === 0) {
      problems.push(`${example}: no transcript.txt or <case>.transcript.txt`)
      continue
    }
    for (const file of files.filter((f) => f === 'input.txt' || f.endsWith('.input.txt'))) {
      const name = file === 'input.txt' ? 'default' : file.slice(0, -'.input.txt'.length)
      if (!names.includes(name)) problems.push(`${example}: ${file} has no matching transcript`)
    }
    for (const name of names) {
      const prefix = name === 'default' ? '' : `${name}.`
      const file = `${prefix}transcript.txt`
      const transcript = readFileSync(join(folder, file), 'utf8')
      if (transcript.includes('\r')) {
        problems.push(
          `${example}: ${file} has carriage returns; goldens use LF line endings (see .gitattributes)`,
        )
        continue
      }
      if (!transcript.endsWith('\n') || transcript.endsWith('\n\n')) {
        problems.push(`${example}: ${file} must end with exactly one line break`)
        continue
      }
      cases.push({
        example,
        name,
        source,
        inputLines: readInput(join(folder, `${prefix}input.txt`)),
        transcript,
      })
    }
  }
  return { cases, problems }
}
