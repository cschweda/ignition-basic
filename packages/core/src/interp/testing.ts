import { FORCE_IDLE } from './vm.ts'
import type { VM } from './vm.ts'

/**
 * Puts a VM into the idle state, which no Phase 1 program can reach, so that the dispatch path
 * can be tested with synthetic events (kickoff prompt, rule 4). Not part of the public API.
 */
export function forceIdle(vm: VM): void {
  const force = (vm as VM & { [FORCE_IDLE]?: () => void })[FORCE_IDLE]
  if (force === undefined) throw new Error('forceIdle needs a VM made by createVM')
  force.call(vm)
}
