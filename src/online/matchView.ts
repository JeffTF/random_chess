import { Chess, type Square } from 'chess.js'
import type {
  Board,
  DrawReason,
  GameStatus,
  PromotionPiece,
} from '../game/types'
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

export interface PredictedMove {
  chess: Chess
  board: Board
  from: Square
  to: Square
}

/**
 * Local-only preview of a move while it is in flight. The transformation is
 * chosen by the server, so this shows the untransformed piece until the
 * authoritative snapshot replaces it. Returns null for anything illegal, so
 * a bad prediction can never reach the board.
 */
export function predictMove(
  fen: string,
  from: Square,
  to: Square,
  promotion?: PromotionPiece,
): PredictedMove | null {
  const chess = new Chess(fen)
  try {
    chess.move({ from, to, promotion })
  } catch {
    return null
  }
  const board: Board = chess
    .board()
    .map((row) => row.map((cell) => (cell ? { ...cell } : null)))
  return { chess, board, from, to }
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
