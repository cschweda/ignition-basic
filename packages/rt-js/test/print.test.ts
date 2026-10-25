import { describe, expect, test } from 'vitest'
import { Printer } from '../src/index.ts'
import { faultCode } from './helpers.ts'

/** A console that records what it is sent; `<CLS>` marks a clear. */
function makePrinter() {
  let out = ''
  const printer = new Printer({
    print: (text) => {
      out += text
    },
    newline: () => {
      out += '\n'
    },
    cls: () => {
      out += '<CLS>'
    },
  })
  return { printer, output: () => out }
}

describe('the PRINT column counter (Doc 01 §7)', () => {
  test('counts code points, not UTF-16 units', () => {
    const { printer } = makePrinter()
    printer.text('A😀B')
    expect(printer.column).toBe(3)
  })

  test('an embedded line break restarts the count', () => {
    const { printer, output } = makePrinter()
    printer.text('AB\nCDE')
    expect(output()).toBe('AB\nCDE')
    expect(printer.column).toBe(3)
  })

  test('newline and CLS reset it to 0', () => {
    const { printer, output } = makePrinter()
    printer.text('ABC')
    printer.newline()
    expect(printer.column).toBe(0)
    printer.text('XY')
    printer.cls()
    expect(printer.column).toBe(0)
    expect(output()).toBe('ABC\nXY<CLS>')
  })

  test('numbers print as formatNumber shows them', () => {
    const { printer, output } = makePrinter()
    printer.number(0.1 + 0.2)
    printer.number(-3)
    expect(output()).toBe('0.3-3')
    expect(printer.column).toBe(5)
  })
})

describe('comma zones are 16 columns wide (Doc 01 §7)', () => {
  test('a comma moves to the next multiple of 16 greater than the column', () => {
    const { printer, output } = makePrinter()
    printer.text('AB')
    printer.comma()
    expect(printer.column).toBe(16)
    printer.comma()
    expect(printer.column).toBe(32)
    expect(output()).toBe('AB' + ' '.repeat(30))
  })

  test('a comma at column 0 moves to 16', () => {
    const { printer } = makePrinter()
    printer.comma()
    expect(printer.column).toBe(16)
  })
})

describe('TAB(n) (Doc 01 §7)', () => {
  test('pads with spaces up to column n, counting from 0', () => {
    const { printer, output } = makePrinter()
    printer.text('AB')
    printer.tab(5)
    expect(output()).toBe('AB   ')
    expect(printer.column).toBe(5)
  })

  test('prints nothing when the column is already at or past n', () => {
    const { printer, output } = makePrinter()
    printer.text('ABC')
    printer.tab(3)
    printer.tab(1)
    expect(output()).toBe('ABC')
  })

  test('truncates n', () => {
    const { printer } = makePrinter()
    printer.tab(5.9)
    expect(printer.column).toBe(5)
  })

  test('n outside 0-255, or not finite, raises ?FC', () => {
    const { printer } = makePrinter()
    expect(faultCode(() => printer.tab(256))).toBe('FC')
    expect(faultCode(() => printer.tab(-1))).toBe('FC')
    expect(faultCode(() => printer.tab(NaN))).toBe('FC')
    expect(faultCode(() => printer.tab(255))).toBeUndefined()
  })
})

describe('startLine', () => {
  test('ends the current line only when the column is not 0', () => {
    const { printer, output } = makePrinter()
    printer.startLine()
    printer.text('X')
    printer.startLine()
    printer.startLine()
    expect(output()).toBe('X\n')
  })
})
