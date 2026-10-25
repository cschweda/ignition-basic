import { fault } from './errors.ts'

/** The largest magnitude a `%` value or a hex literal may have: 2^53 - 1 (Doc 01 §4). */
export const MAX_SAFE = Number.MAX_SAFE_INTEGER

/**
 * Every built-in except STR$ refuses a NaN or infinite numeric argument with ?FC (Doc 01 §12).
 */
export function checkFinite(fn: string, x: number): void {
  if (!Number.isFinite(x))
    fault('FC', `${fn} was given ${Number.isNaN(x) ? 'NAN' : 'an infinite value'}`)
}

/** A built-in whose result would be infinite raises ?OV instead (Doc 01 §12). */
export function checkResult(fn: string, x: number): number {
  if (x === Infinity || x === -Infinity) fault('OV', `${fn} result is too large`)
  return x
}
