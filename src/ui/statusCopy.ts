import type { Color } from 'chess.js'
import type { GameStatus } from '../game/types'
import { colorName, drawReasonLabel } from './pieceDisplay'

export type StatusTone = 'active' | 'check' | 'finished' | 'draw'

export interface StatusCopy {
  headline: string
  detail: string
  tone: StatusTone
}

export function statusCopy(status: GameStatus, turn: Color): StatusCopy {
  switch (status.kind) {
    case 'active':
      return status.inCheck
        ? {
            headline: `${colorName(turn)} is in check`,
            detail: 'Find a legal move that gets the king out of danger.',
            tone: 'check',
          }
        : {
            headline: `${colorName(turn)} to move`,
            detail: 'Pick a piece, then choose a highlighted square.',
            tone: 'active',
          }
    case 'checkmate':
      return {
        headline: `Checkmate — ${colorName(status.winner)} wins`,
        detail: `${colorName(turn)} has no legal reply. The game is over.`,
        tone: 'finished',
      }
    case 'draw': {
      const detail =
        status.reason === 'stalemate'
          ? `${colorName(turn)} has no legal moves, but the king is not in check.`
          : status.reason === 'insufficient-material'
            ? 'Neither side has enough material to force checkmate.'
            : status.reason === 'fifty-move-rule'
              ? 'Fifty moves passed without a pawn move or a capture.'
              : 'The same position occurred three times.'

      return {
        headline: `Draw — ${drawReasonLabel(status.reason)}`,
        detail,
        tone: 'draw',
      }
    }
  }
}
