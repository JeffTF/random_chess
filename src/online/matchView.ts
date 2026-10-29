import { Chess } from 'chess.js'
import type { Board, DrawReason, GameStatus } from '../game/types'
import type { PublicMatch } from './types'

const DRAW_REASONS: ReadonlySet<string> = new Set([
  'stalemate',
  'insufficient-material',
  'fifty-move-rule',
  'threefold-repetition',
])

export interface MatchView {
  chess: Chess
  board: Board
  gameStatus: GameStatus | null
}

/**
 * Read-only projection of the authoritative match document. The client
 * never writes this state; the server replaces it on every move.
 */
export function buildMatchView(match: PublicMatch): MatchView {
  const chess = new Chess(match.fen)
  const board: Board = chess
    .board()
    .map((row) => row.map((cell) => (cell ? { ...cell } : null)))

  return { chess, board, gameStatus: gameStatusFor(match, chess) }
}

function gameStatusFor(
  match: PublicMatch,
  chess: Chess,
): GameStatus | null {
  if (match.status !== 'finished') {
    return { kind: 'active', inCheck: chess.isCheck() }
  }

  if (match.endReason === 'checkmate') {
    const winnerIsWhite =
      match.winnerUid === match.playerWhiteUid
        ? true
        : match.winnerUid === match.playerBlackUid
          ? false
          : match.currentTurn === 'black'

    return { kind: 'checkmate', winner: winnerIsWhite ? 'w' : 'b' }
  }

  if (match.endReason && DRAW_REASONS.has(match.endReason)) {
    return { kind: 'draw', reason: match.endReason as DrawReason }
  }

  // HP and resignation endings are rendered separately.
  return null
}
