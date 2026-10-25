/**
 * Ignition strings are sequences of code points (Master Design §2.3), while JavaScript strings are
 * UTF-16. These helpers do the counting in code points.
 */

/** The number of code points in `s`. */
export function codePointLength(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    // A high surrogate followed by a low one is a single code point.
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) i++
    }
    n++
  }
  return n
}

/** The code points of `s`, as an array of one-code-point strings. */
export function codePoints(s: string): string[] {
  return Array.from(s)
}

/** Code points `start` up to, but not including, `end` (0-based). */
export function sliceCodePoints(s: string, start: number, end?: number): string {
  return codePoints(s).slice(start, end).join('')
}
