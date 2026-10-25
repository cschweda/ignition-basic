/** One line of a diff: unchanged, only in the expected text, or only in the actual text. */
interface Op {
  kind: ' ' | '-' | '+'
  text: string
}

function lines(text: string): string[] {
  const list = text.split('\n')
  if (list.at(-1) === '') list.pop()
  return list
}

/**
 * Trailing spaces and carriage returns are invisible in a terminal, so they are shown as `␠` and
 * `␍`. A CRLF checkout of a golden would otherwise produce a diff of identical-looking lines.
 */
const visible = (line: string): string =>
  line.replace(/\r/g, '␍').replace(/ +$/, (spaces) => '␠'.repeat(spaces.length))

/**
 * A unified diff of two texts, line by line, with `context` lines around each change. Returns ''
 * when the texts are equal.
 */
export function unifiedDiff(
  expected: string,
  actual: string,
  expectedLabel = 'expected',
  actualLabel = 'actual',
  context = 3,
): string {
  if (expected === actual) return ''
  const a = lines(expected)
  const b = lines(actual)

  // The longest common subsequence, filled from the end so the walk below can go forward.
  const common = Array.from({ length: a.length + 1 }, () => new Int32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const row = common[i]
      if (!row) continue
      row[j] =
        a[i] === b[j]
          ? (common[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(common[i + 1]?.[j] ?? 0, row[j + 1] ?? 0)
    }
  }

  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      ops.push({ kind: ' ', text: a[i++] ?? '' })
      j++
    } else if (
      j >= b.length ||
      (i < a.length && (common[i + 1]?.[j] ?? 0) >= (common[i]?.[j + 1] ?? 0))
    ) {
      ops.push({ kind: '-', text: a[i++] ?? '' })
    } else {
      ops.push({ kind: '+', text: b[j++] ?? '' })
    }
  }

  // Group the changes into hunks, merging those whose context would overlap.
  const changed = ops.flatMap((op, k) => (op.kind === ' ' ? [] : [k]))
  const hunks: [number, number][] = []
  for (const k of changed) {
    const from = Math.max(0, k - context)
    const to = Math.min(ops.length - 1, k + context)
    const last = hunks.at(-1)
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to)
    else hunks.push([from, to])
  }

  const out = [`--- ${expectedLabel}`, `+++ ${actualLabel}`]
  if (hunks.length === 0) out.push('(the texts differ only in their final line break)')
  for (const [from, to] of hunks) {
    const before = ops.slice(0, from)
    const aStart = before.filter((op) => op.kind !== '+').length + 1
    const bStart = before.filter((op) => op.kind !== '-').length + 1
    const body = ops.slice(from, to + 1)
    const aCount = body.filter((op) => op.kind !== '+').length
    const bCount = body.filter((op) => op.kind !== '-').length
    out.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`)
    for (const op of body) out.push(op.kind + visible(op.text))
  }
  return out.join('\n') + '\n'
}
