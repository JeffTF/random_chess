import type { TransformablePieceType } from './types'

export const PROMOTION_PIECES = ['q', 'r', 'b', 'n'] as const

export interface TransformationConfig {
  candidateTypes: readonly TransformablePieceType[]
  pawnForbiddenRanks: readonly number[]
}

export interface HpConfig {
  starting: number
  max: number
}

export interface GameConfig {
  transformation: TransformationConfig
  hp: HpConfig
}

export const GAME_CONFIG: GameConfig = {
  transformation: {
    candidateTypes: ['p', 'n', 'b', 'r', 'q'],
    pawnForbiddenRanks: [1, 8],
  },
  hp: {
    starting: 100,
    max: 100,
  },
}
