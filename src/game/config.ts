import type { TransformablePieceType } from './types'

export const PROMOTION_PIECES = ['q', 'r', 'b', 'n'] as const

export interface TransformationConfig {
  candidateTypes: readonly TransformablePieceType[]
  pawnForbiddenRanks: readonly number[]
}

export interface GameConfig {
  transformation: TransformationConfig
}

export const GAME_CONFIG: GameConfig = {
  transformation: {
    candidateTypes: ['p', 'n', 'b', 'r', 'q'],
    pawnForbiddenRanks: [1, 8],
  },
}
