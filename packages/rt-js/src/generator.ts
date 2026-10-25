import { checkFinite, MAX_SAFE } from './checks.ts'
import { fault } from './errors.ts'

/**
 * The generator's state, as plain data so it can live in the VM state (Doc 01 §16):
 * xorshift128+'s two words, and the last value drawn since seeding (for RND(0)).
 */
export interface GeneratorState {
  s0: bigint
  s1: bigint
  last: number | null
}

const MASK64 = (1n << 64n) - 1n

/** One SplitMix64 step: advances `x` and returns the new state and the output. */
function splitmix64(x: bigint): [state: bigint, output: bigint] {
  const state = (x + 0x9e3779b97f4a7c15n) & MASK64
  let z = state
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64
  return [state, z ^ (z >> 31n)]
}

/** Seeds `g` with the whole number `k`, |k| <= 2^53 - 1, as Doc 01 §13 specifies. */
function seed(g: GeneratorState, k: number): void {
  const [x, s0] = splitmix64(BigInt.asUintN(64, BigInt(k)))
  const [, s1] = splitmix64(x)
  g.s0 = s0
  g.s1 = s1
  g.last = null
}

/** A generator seeded with 0, the state every program starts with. */
export function createGenerator(): GeneratorState {
  const g: GeneratorState = { s0: 0n, s1: 0n, last: null }
  seed(g, 0)
  return g
}

/** xorshift128+ with shifts 23, 18 and 5: draws one float in [0, 1) and remembers it. */
export function nextFloat(g: GeneratorState): number {
  let t = g.s0
  const u = g.s1
  const result = (u + t) & MASK64
  g.s0 = u
  t = (t ^ (t << 23n)) & MASK64
  g.s1 = t ^ u ^ (t >> 18n) ^ (u >> 5n)
  const value = Number(result >> 11n) * 2 ** -53
  g.last = value
  return value
}

/** RANDOMIZE n: seeds with FIX(n); a non-finite n or |FIX(n)| > 2^53 - 1 raises ?FC. */
export function randomize(g: GeneratorState, n: number): void {
  checkFinite('RANDOMIZE', n)
  const k = Math.trunc(n)
  if (Math.abs(k) > MAX_SAFE) fault('FC', `RANDOMIZE ${n} is outside ±(2^53 - 1)`)
  seed(g, k)
}

/**
 * RND(x) (Doc 01 §13). 0 repeats the last value (drawing one if there is none); up to 1 draws a
 * fraction; above 1 returns a whole number from 1 to FIX(x). Every case but 0 draws exactly one
 * value, and that fraction becomes the last value.
 */
export function rnd(g: GeneratorState, x: number): number {
  checkFinite('RND', x)
  if (x < 0) fault('FC', `RND of a negative number (${x})`)
  if (x === 0) return g.last ?? nextFloat(g)
  if (x <= 1) return nextFloat(g)
  const m = Math.trunc(x)
  if (m > MAX_SAFE) fault('FC', `RND(${x}) is above 2^53 - 1`)
  const u = nextFloat(g)
  return Math.min(m, 1 + Math.trunc(u * m))
}
