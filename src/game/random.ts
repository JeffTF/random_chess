import type { RandomSource } from './types'

export function randomIndex(random: RandomSource, length: number): number {
  if (!Number.isInteger(length) || length <= 0) {
    throw new Error('Random selection requires a positive length.')
  }

  const value = random()
  if (!Number.isFinite(value)) {
    throw new Error('Random source must return a finite number.')
  }

  const normalized = Math.min(Math.max(value, 0), 1 - Number.EPSILON)
  return Math.floor(normalized * length)
}
