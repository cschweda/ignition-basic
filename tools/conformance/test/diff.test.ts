import { describe, expect, test } from 'vitest'
import { unifiedDiff } from '../src/diff.ts'

describe('unifiedDiff', () => {
  test('is empty for equal texts', () => {
    expect(unifiedDiff('A\nB\n', 'A\nB\n')).toBe('')
  })

  test('shows a changed line with its context', () => {
    expect(unifiedDiff('A\nB\nC\n', 'A\nX\nC\n', 'expected', 'actual')).toBe(
      ['--- expected', '+++ actual', '@@ -1,3 +1,3 @@', ' A', '-B', '+X', ' C', ''].join('\n'),
    )
  })

  test('shows added and removed lines', () => {
    expect(unifiedDiff('A\n', 'A\nB\n', 'e', 'a')).toBe(
      ['--- e', '+++ a', '@@ -1,1 +1,2 @@', ' A', '+B', ''].join('\n'),
    )
  })

  test('shows trailing spaces as ␠ so they can be seen', () => {
    expect(unifiedDiff('A\n', 'A \n', 'e', 'a')).toBe(
      ['--- e', '+++ a', '@@ -1,1 +1,1 @@', '-A', '+A␠', ''].join('\n'),
    )
  })

  test('keeps three lines of context and separates distant changes into hunks', () => {
    const before = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'].join('\n') + '\n'
    const after = before.replace('2\n', 'two\n').replace('11\n', 'eleven\n')
    expect(
      unifiedDiff(before, after, 'e', 'a')
        .split('\n')
        .filter((l) => l.startsWith('@@')),
    ).toEqual(['@@ -1,5 +1,5 @@', '@@ -8,5 +8,5 @@'])
  })
})
