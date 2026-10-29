import type { PieceSymbol, Square } from 'chess.js'
import { GAME_CONFIG, type TransformationConfig } from './config'
import { randomIndex } from './random'
import type { RandomSource, TransformablePieceType } from './types'

export function isTransformablePiece(
  type: PieceSymbol,
): type is TransformablePieceType {
  return type !== 'k'
}

export function squareRank(square: Square): number {
  return Number(square[1])
}

export function transformationCandidates(
  currentType: TransformablePieceType,
  destination: Square,
  config: TransformationConfig = GAME_CONFIG.transformation,
): TransformablePieceType[] {
  const forbiddenPawnRank = config.pawnForbiddenRanks.includes(
    squareRank(destination),
  )

  return config.candidateTypes.filter(
    (type) => type !== currentType && !(type === 'p' && forbiddenPawnRank),
  )
}

export function chooseTransformation(
  currentType: PieceSymbol,
  destination: Square,
  random: RandomSource,
  config: TransformationConfig = GAME_CONFIG.transformation,
): TransformablePieceType {
  if (!isTransformablePiece(currentType)) {
    throw new Error('Kings never transform.')
  }

  const candidates = transformationCandidates(currentType, destination, config)
  if (candidates.length === 0) {
    throw new Error('No valid transformation type is available.')
  }

  return candidates[randomIndex(random, candidates.length)]!
}
