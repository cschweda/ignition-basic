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

/** The layout rules a dialect's PRINT follows. Ignition: zones 16 wide, no line width (Doc 01 §7). */
export interface PrintRules {
  zoneWidth: number
}

export const IGNITION_PRINT_RULES: PrintRules = { zoneWidth: 16 }

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

  /** Prints a number as Doc 01 §6 formats it. */
  number(x: number): void {
    this.text(formatNumber(x))
  }

  /** A `,` separator: spaces up to the next zone boundary greater than the current column. */
  comma(): void {
    const width = this.#rules.zoneWidth
    const next = (Math.floor(this.#column / width) + 1) * width
    this.text(' '.repeat(next - this.#column))
  }

  /** TAB(n): spaces up to column `n` (counting from 0), or nothing if already there or past. */
  tab(n: number): void {
    checkFinite('TAB', n)
    const target = Math.trunc(n)
    if (target < 0 || target > 255) fault('FC', `TAB(${target}) is outside 0 to 255`)
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
