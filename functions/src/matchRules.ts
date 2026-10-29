import { Chess, type Color, type Square } from 'chess.js'
import { ChaosChessGame } from '../../src/game/ChaosChessGame'
import { ChessRuleError, type GameErrorCode } from '../../src/game/errors'
import { replacePieceInFen } from '../../src/game/fen'
import type {
  GameStatus,
  MoveEffects,
  MoveRecord,
  RandomSource,
} from '../../src/game/types'
import { EVENT_TUNING } from '../../src/game/events'
import {
  clampHp,
  hpEnding,
  hpPairFor,
  STARTING_HP,
  startingHpFor,
} from './hp'
import type {
  BoardEffects,
  EndReason,
  HpByUid,
  MatchDocument,
  MatchSide,
  MoveOutcome,
  MoveRequest,
} from './types'

export type MatchRuleReason =
  | 'not-a-member'
  | 'wrong-turn'
  | 'match-not-active'
  | 'stale-version'
  | 'invalid-move'
  | 'event-pending'
  | 'event-not-pending'
  | 'not-event-target'
  | 'cannot-afford'
  | 'invalid-selection'

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

export function uidForSide(
  state: MatchDocument,
  side: MatchSide,
): string | null {
  return side === 'white' ? state.playerWhiteUid : state.playerBlackUid
}

export function sideForColor(color: Color): MatchSide {
  return color === 'w' ? 'white' : 'black'
}

export function oppositeSide(side: MatchSide): MatchSide {
  return side === 'white' ? 'black' : 'white'
}

export function colorForSide(side: MatchSide): Color {
  return side === 'white' ? 'w' : 'b'
}

export function emptyEffects(): BoardEffects {
  return { bombs: [], shields: [], hijack: null }
}

export function normalizeEffects(
  effects: Partial<BoardEffects> | null | undefined,
): BoardEffects {
  return {
    bombs: (effects?.bombs ?? []).map((bomb) => ({ ...bomb })),
    shields: (effects?.shields ?? []).map((shield) => ({ ...shield })),
    hijack: effects?.hijack ?? null,
  }
}

/**
 * Matches created before Phases 4–5 have no event or effect fields. Default
 * them here so old documents keep playing instead of failing to load.
 */
export function normalizeMatch(
  raw: MatchDocument | Record<string, unknown>,
): MatchDocument {
  const state = raw as Partial<MatchDocument>
  return {
    ...(state as MatchDocument),
    event: state.event ?? null,
    effects: normalizeEffects(state.effects),
    lastEvent: state.lastEvent ?? null,
    lastEventPly: state.lastEventPly ?? null,
  }
}

export function endFields(
  status: GameStatus,
  state: MatchDocument,
): Pick<MatchDocument, 'status' | 'winnerUid' | 'endReason'> {
  if (status.kind === 'checkmate') {
    return {
      status: 'finished',
      winnerUid: uidForSide(
        state,
        status.winner === 'w' ? 'white' : 'black',
      ),
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

function enPassantCapturedSquare(
  from: Square,
  to: Square,
  pieceType: string | undefined,
  hasTargetPiece: boolean,
): Square | null {
  if (hasTargetPiece) {
    return to
  }
  if (pieceType === 'p' && from[0] !== to[0]) {
    return `${to[0]}${from[1]}` as Square
  }
  return null
}

/**
 * A hijack must never leave the former owner's king attacked, because the
 * resulting position would be unrepresentable for normal play. In that case
 * the hijack is consumed without changing the piece.
 */
function hijackKeepsPositionSound(
  fen: string,
  formerOwner: Color,
  hijacker: Color,
): boolean {
  try {
    const chess = new Chess(fen)
    const kingSquare = chess.findPiece({ type: 'k', color: formerOwner })[0]
    if (!kingSquare) {
      return false
    }
    return !chess.isAttacked(kingSquare, hijacker)
  } catch {
    return false
  }
}

/**
 * Validates and applies one move on top of the stored public match state.
 * Pure apart from the injected random source, so the same code runs in
 * unit tests and in the deployed function.
 *
 * Move-triggered effects resolve in this order: shield block (cancels the
 * move), bomb damage, hijack transfer, triple-bomb expiry. HP is then
 * evaluated before chess endings, matching the documented precedence.
 */
export function applyMove(
  state: MatchDocument,
  request: MoveRequest,
  random: RandomSource,
  hp: HpByUid = startingHpFor(state),
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

  try {
    game.validateMove(request.from, request.to, request.promotion)
  } catch (error) {
    if (error instanceof ChessRuleError && INVALID_MOVE_CODES.has(error.code)) {
      throw new MatchRuleError('invalid-move', error.message)
    }
    throw error
  }

  const boardBefore = new Chess(state.fen)
  const pieceBefore = boardBefore.get(request.from)
  if (!pieceBefore) {
    throw new MatchRuleError('invalid-move', 'There is no piece on that square.')
  }
  const targetPiece = boardBefore.get(request.to)
  const capturedSquare = enPassantCapturedSquare(
    request.from,
    request.to,
    pieceBefore.type,
    Boolean(targetPiece),
  )

  const effects = normalizeEffects(state.effects)

  // A shield cancels the capture before anything is applied. En passant
  // captures target the pawn's square, not the destination square.
  if (targetPiece && targetPiece.color !== pieceBefore.color) {
    const shield = effects.shields.find(
      (marker) => marker.square === (capturedSquare ?? request.to),
    )
    if (shield) {
      const shieldedPiece = boardBefore.get(shield.square)
      const next: MatchDocument = {
        ...state,
        effects: {
          ...effects,
          shields: effects.shields.filter((marker) => marker !== shield),
        },
        version: state.version + 1,
      }
      return {
        record: null,
        pieceBefore: { type: pieceBefore.type, color: pieceBefore.color },
        pieceAfter: shieldedPiece
          ? { type: shieldedPiece.type, color: shieldedPiece.color }
          : null,
        next,
        hp,
        blocked: 'shield',
      }
    }
  }

  let record: MoveRecord
  try {
    record = game.move(request.from, request.to, request.promotion)
  } catch (error) {
    if (error instanceof ChessRuleError && INVALID_MOVE_CODES.has(error.code)) {
      throw new MatchRuleError('invalid-move', error.message)
    }
    throw error
  }

  let finalFen = game.fen
  const history: MoveRecord[] = [...game.history]
  let status: GameStatus = game.status
  const nextEffects: BoardEffects = normalizeEffects(effects)
  const moveEffects: MoveEffects = {}
  let damage = 0

  const moverUid = request.playerUid
  const moverSide = side
  const moverColor = record.color
  const hijackerColor: Color = moverColor === 'w' ? 'b' : 'w'

  // The moved piece carried a triple bomb: it triggers on the mover.
  const carriedBomb = nextEffects.bombs.findIndex(
    (bomb) => bomb.square === request.from && bomb.kind === 'triple',
  )
  if (carriedBomb >= 0) {
    damage += EVENT_TUNING.tripleBomb.damage
    nextEffects.bombs.splice(carriedBomb, 1)
  }

  // Bombs on the captured piece: a friendly bomb hurts the capturer; any
  // other bomb on that piece is simply removed.
  if (capturedSquare) {
    for (let index = nextEffects.bombs.length - 1; index >= 0; index -= 1) {
      const bomb = nextEffects.bombs[index]!
      if (bomb.square !== capturedSquare) {
        continue
      }
      if (bomb.kind === 'friendly') {
        damage += EVENT_TUNING.friendlyBomb.damage
      }
      nextEffects.bombs.splice(index, 1)
    }
  }

  // Markers attached to the moved piece travel with it.
  for (const shield of nextEffects.shields) {
    if (shield.square === request.from) {
      shield.square = request.to
    }
  }
  for (const bomb of nextEffects.bombs) {
    if (bomb.square === request.from && bomb.kind === 'friendly') {
      bomb.square = request.to
    }
  }

  // Triple bombs tick down on the target side's moves.
  nextEffects.bombs = nextEffects.bombs.filter((bomb) => {
    if (bomb.kind !== 'triple' || bomb.side !== moverSide) {
      return true
    }
    bomb.movesLeft = (bomb.movesLeft ?? 1) - 1
    return bomb.movesLeft > 0
  })

  let hijackApplied = false
  if (nextEffects.hijack && nextEffects.hijack.byUid !== moverUid) {
    nextEffects.hijack = null
    const movedPiece = new Chess(finalFen).get(request.to)
    if (movedPiece && movedPiece.type !== 'k') {
      const convertedFen = replacePieceInFen(
        finalFen,
        request.to,
        { type: movedPiece.type, color: hijackerColor },
        { clearEnPassant: true },
      )
      if (
        hijackKeepsPositionSound(convertedFen, moverColor, hijackerColor)
      ) {
        finalFen = convertedFen
        hijackApplied = true
      }
    }
  }

  if (hijackApplied) {
    // The transfer happens after the move, so check status must be
    // recalculated from the defected position.
    history[history.length - 1] = {
      ...history[history.length - 1]!,
      fen: finalFen,
    }
    const rebuilt = new ChaosChessGame({
      fen: finalFen,
      startFen: state.startFen,
      history,
      version: state.version,
      random: () => 0.5,
    })
    status = rebuilt.status
  }

  if (damage > 0) {
    moveEffects.bombDamage = damage
  }
  if (hijackApplied) {
    moveEffects.hijacked = true
  }
  if (Object.keys(moveEffects).length > 0) {
    history[history.length - 1] = {
      ...history[history.length - 1]!,
      effects: moveEffects,
    }
  }
  const finalRecord = history[history.length - 1]!

  const nextHp: HpByUid = { ...hp }
  if (damage > 0) {
    nextHp[moverUid] = clampHp(
      (nextHp[moverUid] ?? STARTING_HP) - damage,
    )
  }

  // HP is evaluated after the chess position, so depleted HP takes
  // precedence over a simultaneous checkmate or draw.
  const ending =
    hpEnding(
      hpPairFor(state, nextHp),
      state.playerWhiteUid,
      state.playerBlackUid,
    ) ?? endFields(status, state)

  const next: MatchDocument = {
    ...state,
    status: ending.status,
    winnerUid: ending.winnerUid,
    endReason: ending.endReason,
    currentTurn: sideForColor(game.turn),
    fen: finalFen,
    plyCount: history.length,
    version: state.version + 1,
    history,
    lastMove: { from: record.from, to: record.to },
    effects: nextEffects,
  }

  const pieceAfter = new Chess(finalFen).get(request.to)

  return {
    record: finalRecord,
    pieceBefore: { type: pieceBefore.type, color: pieceBefore.color },
    pieceAfter: pieceAfter
      ? { type: pieceAfter.type, color: pieceAfter.color }
      : null,
    next,
    hp: nextHp,
    blocked: null,
  }
}

export function assertSquare(value: unknown, field: string): Square {
  if (typeof value !== 'string' || !/^[a-h][1-8]$/.test(value)) {
    throw new Error(`${field} must be a square such as e2.`)
  }
  return value as Square
}
