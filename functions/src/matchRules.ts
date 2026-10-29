import { Chess, type Square } from 'chess.js'
import { ChaosChessGame } from '../../src/game/ChaosChessGame'
import { ChessRuleError, type GameErrorCode } from '../../src/game/errors'
import type { GameStatus, RandomSource } from '../../src/game/types'
import type {
  EndReason,
  MatchDocument,
  MatchSide,
  MoveOutcome,
  MoveRequest,
} from './types'
import type { MoveRecord } from '../../src/game/types'

export type MatchRuleReason =
  | 'not-a-member'
  | 'wrong-turn'
  | 'match-not-active'
  | 'stale-version'
  | 'invalid-move'

export class MatchRuleError extends Error {
  constructor(
    readonly reason: MatchRuleReason,
    message: string,
  ) {
    super(message)
  }
}

const INVALID_MOVE_CODES: ReadonlySet<GameErrorCode> = new Set([
  'game-over',
  'no-piece',
  'wrong-turn',
  'illegal-move',
  'promotion-required',
  'invalid-promotion',
  'invalid-transformation',
])

export function sideOf(state: MatchDocument, uid: string): MatchSide | null {
  if (state.playerWhiteUid === uid) {
    return 'white'
  }
  if (state.playerBlackUid === uid) {
    return 'black'
  }
  return null
}

function uidForSide(state: MatchDocument, side: MatchSide): string | null {
  return side === 'white' ? state.playerWhiteUid : state.playerBlackUid
}

function endFields(
  status: GameStatus,
  state: MatchDocument,
): Pick<MatchDocument, 'status' | 'winnerUid' | 'endReason'> {
  if (status.kind === 'checkmate') {
    return {
      status: 'finished',
      winnerUid: uidForSide(state, status.winner === 'w' ? 'white' : 'black'),
      endReason: 'checkmate',
    }
  }
  if (status.kind === 'draw') {
    return {
      status: 'finished',
      winnerUid: null,
      endReason: status.reason satisfies EndReason,
    }
  }
  return { status: 'active', winnerUid: null, endReason: null }
}

/**
 * Validates and applies one move on top of the stored public match state.
 * Pure apart from the injected random source, so the same code runs in
 * unit tests and in the deployed function.
 */
export function applyMove(
  state: MatchDocument,
  request: MoveRequest,
  random: RandomSource,
): MoveOutcome {
  if (state.status !== 'active') {
    throw new MatchRuleError(
      'match-not-active',
      'This match is not accepting moves.',
    )
  }

  const side = sideOf(state, request.playerUid)
  if (!side) {
    throw new MatchRuleError(
      'not-a-member',
      'You are not a player in this match.',
    )
  }
  if (state.currentTurn !== side) {
    throw new MatchRuleError('wrong-turn', 'It is not your turn.')
  }
  if (request.expectedVersion !== state.version) {
    throw new MatchRuleError(
      'stale-version',
      'The board has already changed. Look at the latest position and try again.',
    )
  }

  const game = new ChaosChessGame({
    fen: state.fen,
    startFen: state.startFen,
    history: state.history,
    version: state.version,
    random,
  })

  const beforeBoard = new Chess(state.fen)
  const pieceBefore = beforeBoard.get(request.from)

  let record: MoveRecord
  try {
    record = game.move(request.from, request.to, request.promotion)
  } catch (error) {
    if (error instanceof ChessRuleError && INVALID_MOVE_CODES.has(error.code)) {
      throw new MatchRuleError('invalid-move', error.message)
    }
    throw error
  }

  const snapshot = game.snapshot()
  const pieceAfter = new Chess(snapshot.fen).get(request.to)
  const ending = endFields(snapshot.status, state)

  const next: MatchDocument = {
    ...state,
    status: ending.status,
    winnerUid: ending.winnerUid,
    endReason: ending.endReason,
    currentTurn: snapshot.turn === 'w' ? 'white' : 'black',
    fen: snapshot.fen,
    plyCount: snapshot.history.length,
    version: snapshot.version,
    history: [...snapshot.history],
    lastMove: snapshot.lastMove,
  }

  return {
    record,
    pieceBefore: pieceBefore
      ? { type: pieceBefore.type, color: pieceBefore.color }
      : null,
    pieceAfter: pieceAfter
      ? { type: pieceAfter.type, color: pieceAfter.color }
      : null,
    next,
  }
}

export function assertSquare(value: unknown, field: string): Square {
  if (typeof value !== 'string' || !/^[a-h][1-8]$/.test(value)) {
    throw new Error(`${field} must be a square such as e2.`)
  }
  return value as Square
}
