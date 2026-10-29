import type { Square } from 'chess.js'
import type { MoveRecord, PromotionPiece } from '../../src/game/types'

export type MatchSide = 'white' | 'black'

export type MatchStatus = 'waiting' | 'active' | 'event_pending' | 'finished'

export type EndReason =
  | 'checkmate'
  | 'stalemate'
  | 'insufficient-material'
  | 'fifty-move-rule'
  | 'threefold-repetition'
  | 'hp-depleted'
  | 'resignation'

/**
 * Public match state. Anything private (HP in later phases) belongs in
 * matches/{matchId}/private/{uid} instead.
 */
export interface MatchDocument {
  status: MatchStatus
  roomCode: string
  playerWhiteUid: string | null
  playerBlackUid: string | null
  currentTurn: MatchSide
  fen: string
  startFen: string
  plyCount: number
  version: number
  history: MoveRecord[]
  lastMove: { from: Square; to: Square } | null
  winnerUid: string | null
  endReason: EndReason | null
}

export interface MoveRequest {
  playerUid: string
  expectedVersion: number
  from: Square
  to: Square
  promotion?: PromotionPiece
}

export interface MoveOutcome {
  record: MoveRecord
  pieceBefore: { type: string; color: string } | null
  pieceAfter: { type: string; color: string } | null
  next: MatchDocument
}
