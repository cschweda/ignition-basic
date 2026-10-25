import { MAX_SAFE } from './checks.ts'
import { parseCompleteNumeric } from './numeric.ts'

/** One comma-separated field of an INPUT line. */
export interface InputField {
  text: string
  /** True when the field was written in double quotes; `text` is then what was between them. */
  quoted: boolean
}

/** What an INPUT target can hold: a number, a `%` integer or a string. */
export type InputTarget = 'number' | 'integer' | 'string'

const trimSpaces = (s: string): string => s.replace(/^ +| +$/g, '')

/**
 * Splits an INPUT line at commas (Doc 01 §8, step 3). Each field is trimmed of spaces; a field that
 * starts with `"` runs to the next `"` and may contain commas. Returns null for an invalid line:
 * anything but spaces between a closing quote and the next comma, or a quote that never closes.
 */
export function splitInputLine(line: string): InputField[] | null {
  const fields: InputField[] = []
  let i = 0
  for (;;) {
    while (line[i] === ' ') i++
    if (line[i] === '"') {
      const close = line.indexOf('"', i + 1)
      if (close === -1) return null
      fields.push({ text: line.slice(i + 1, close), quoted: true })
      i = close + 1
      while (line[i] === ' ') i++
      if (i < line.length && line[i] !== ',') return null
    } else {
      const comma = line.indexOf(',', i)
      const end = comma === -1 ? line.length : comma
      fields.push({ text: trimSpaces(line.slice(i, end)), quoted: false })
      i = end
    }
    if (i >= line.length) return fields
    i++ // past the comma; a trailing comma leaves one more, empty, field
  }
}

/** A single string target takes the whole line, trimmed of spaces, commas and all. */
export function wholeLineField(line: string): string {
  return trimSpaces(line)
}

/**
 * Converts a field for its target (Doc 01 §8, step 6), or returns null when the field is invalid
 * for it: a numeric target needs a complete, finite literal in the shared grammar, unquoted, and a
 * `%` target also needs the value to fit ±(2^53 - 1) once truncated. A string target takes any field.
 */
export function convertInputField(field: InputField, target: InputTarget): number | string | null {
  if (target === 'string') return field.text
  if (field.quoted) return null
  const found = parseCompleteNumeric(field.text)
  if (found === null || found.outOfRange) return null
  if (target === 'integer' && Math.abs(Math.trunc(found.value)) > MAX_SAFE) return null
  return found.value
}
