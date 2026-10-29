import { randomInt } from 'node:crypto'
import type { RandomSource } from '../../src/game/types'

/** Uniform float in [0, 1) backed by the platform CSPRNG. */
export const secureRandom: RandomSource = () => randomInt(0, 1_000_000) / 1_000_000

export function secureRandomInt(maxExclusive: number): number {
  return randomInt(maxExclusive)
}
