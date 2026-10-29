import type { Color, Square } from 'chess.js'
import type { Timestamp } from 'firebase/firestore'
import type { EventKind } from '../game/events'
import type { BoardEffects, MoveRecord } from '../game/types'

export type {
  BoardEffects,
  BombKind,
  BombMarker,
  ShieldMarker,
} from '../game/types'

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

/** Public match state; private HP lives in a separate document. */
export interface PublicMatch {
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
  lastEventPly: number | null
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
}

export function sideForUid(
  match: PublicMatch,
  uid: string,
): MatchSide | null {
  if (match.playerWhiteUid === uid) {
    return 'white'
  }
  if (match.playerBlackUid === uid) {
    return 'black'
  }
  return null
}

export function sideToColor(side: MatchSide): Color {
  return side === 'white' ? 'w' : 'b'
}

export function colorToSide(color: Color): MatchSide {
  return color === 'w' ? 'white' : 'black'
}

export function describeEndReason(reason: EndReason | null): string {
  switch (reason) {
    case 'checkmate':
      return 'Checkmate'
    case 'stalemate':
      return 'Stalemate'
    case 'insufficient-material':
      return 'Insufficient material'
    case 'fifty-move-rule':
      return 'Fifty-move rule'
    case 'threefold-repetition':
      return 'Threefold repetition'
    case 'hp-depleted':
      return 'HP reached zero'
    case 'resignation':
      return 'Resignation'
    default:
      return 'Game over'
  }
}
