import { checkFinite } from './checks.ts'
import { fault } from './errors.ts'
import { formatNumber } from './format.ts'
import { codePointLength } from './strings.ts'

/** Where printed text goes: the output half of a console adapter (Doc 01 §16). */
export interface ConsoleSink {
  /** May contain "\n" (from CHR$(10)); the console renders it as a line break. */
  print(text: string): void
  newline(): void
  cls(): void
}

/**
 * What a dialect's PRINT does differently: its zone width and how it shows a number. Ignition's
 * zones are 16 wide, it has no line width, and numbers follow Doc 01 §6.
 */
export interface PrintRules {
  zoneWidth: number
  formatNumber(x: number): string
}

export const IGNITION_PRINT_RULES: PrintRules = { zoneWidth: 16, formatNumber }

/**
 * PRINT's column logic (Doc 01 §7), shared by every console so they all print identically.
 * `column` counts code points since the last line break; Ignition never wraps.
 */
export class Printer {
  #column = 0
  readonly #sink: ConsoleSink
  readonly #rules: PrintRules

  constructor(sink: ConsoleSink, rules: PrintRules = IGNITION_PRINT_RULES) {
    this.#sink = sink
    this.#rules = rules
  }

  /** Code points printed since the last line break. */
  get column(): number {
    return this.#column
  }

  /** Prints a string as it is. */
  text(s: string): void {
    if (s === '') return
    this.#sink.print(s)
    const lastBreak = s.lastIndexOf('\n')
    this.#column =
      lastBreak === -1 ? this.#column + codePointLength(s) : codePointLength(s.slice(lastBreak + 1))
  }

  /** Prints a number the way the dialect shows it. */
  number(x: number): void {
    this.text(this.#rules.formatNumber(x))
  }

  /** A `,` separator: spaces up to the next zone boundary greater than the current column. */
  comma(): void {
    const width = this.#rules.zoneWidth
    const next = (Math.floor(this.#column / width) + 1) * width
    this.text(' '.repeat(next - this.#column))
  }

  /** TAB(n): spaces up to column `n` (counting from 0), or nothing if already there or past. */
  tab(n: number): void {
    const target = tabColumn(n)
    if (this.#column < target) this.text(' '.repeat(target - this.#column))
  }

  newline(): void {
    this.#sink.newline()
    this.#column = 0
  }

  cls(): void {
    this.#sink.cls()
    this.#column = 0
  }

  /** Starts a new line unless the cursor is already at the start of one. */
  startLine(): void {
    if (this.#column !== 0) this.newline()
  }
}

/**
 * Checks a TAB argument and returns the column it asks for (Doc 01 §7): truncated, and within
 * 0-255 or ?FC. PRINT checks every item before printing any, so this runs on its own first.
 */
export function tabColumn(n: number): number {
  checkFinite('TAB', n)
  const column = Math.trunc(n)
  if (column < 0 || column > 255) fault('FC', `TAB(${column}) is outside 0 to 255`)
  return column
}
