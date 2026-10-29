import type { Square } from 'chess.js'
import type { EventKind } from '../../src/game/events'
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

export type BombKind = 'friendly' | 'triple'

/** Public bomb marker. Triple bombs expire; friendly bombs do not. */
export interface BombMarker {
  square: Square
  /** Side that owns the piece the bomb sits on. */
  side: MatchSide
  kind: BombKind
  /** Remaining moves for a triple bomb; null for a friendly bomb. */
  movesLeft: number | null
}

/** Public shield marker. */
export interface ShieldMarker {
  square: Square
  side: MatchSide
}

export interface BoardEffects {
  bombs: BombMarker[]
  shields: ShieldMarker[]
  hijack: { byUid: string } | null
}

export interface EventOffer {
  id: string
  kind: EventKind
  offeredTo: MatchSide
  cost: number
  requiresPiece: boolean
  createdAtMs: number
  expiresAtMs: number
}

export interface EventSummary {
  id: string
  kind: EventKind
  byUid: string | null
  outcome: 'accepted' | 'declined' | 'expired'
  endedMatch: boolean
}

/**
 * Public match state. Private HP lives in matches/{matchId}/private/{uid};
 * published effect markers never contain HP.
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
  event: EventOffer | null
  effects: BoardEffects
  lastEvent: EventSummary | null
  /** Ply number of the most recent offer, used for the minimum gap. */
  lastEventPly: number | null
}

/** Owner-only state stored in matches/{matchId}/private/{uid}. */
export interface PrivateMatchDocument {
  hp: number
  reverseUsed?: boolean
}

/** Public record of one offer; contains no HP and no private choices. */
export interface EventDocument {
  kind: EventKind
  offeredToUid: string
  cost: number
  status: 'pending' | 'accepted' | 'declined' | 'expired'
  createdAtMs: number
  expiresAtMs: number
  resolvedAtMs: number | null
}

export interface MoveRequest {
  playerUid: string
  expectedVersion: number
  from: Square
  to: Square
  promotion?: PromotionPiece
}

export type HpByUid = Record<string, number>
export type PrivateByUid = Record<string, PrivateMatchDocument>

export interface MoveOutcome {
  record: MoveRecord | null
  pieceBefore: { type: string; color: string } | null
  pieceAfter: { type: string; color: string } | null
  next: MatchDocument
  hp: HpByUid
  /** Set when an event effect cancelled the move entirely. */
  blocked: 'shield' | null
}
