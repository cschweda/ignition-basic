import { BasicFault } from '../src/index.ts'

/** Runs `f` and returns the code of the BasicFault it raises, or undefined if it returns normally. */
export function faultCode(f: () => unknown): string | undefined {
  try {
    f()
  } catch (e) {
    if (e instanceof BasicFault) return e.code
    throw e
  }
  return undefined
}
