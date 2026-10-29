import {
  Chess,
  type Color,
  type Move,
  type PieceSymbol,
  type Square,
} from 'chess.js'
import { GAME_CONFIG, PROMOTION_PIECES, type TransformationConfig } from './config'
import { ChessRuleError } from './errors'
import { PositionTracker, replacePieceInFen } from './fen'
import { chooseTransformation, squareRank } from './transform'
import type {
  Board,
  DrawReason,
  GameSnapshot,
  GameStatus,
  LegalMove,
  MoveRecord,
  PromotionPiece,
  RandomSource,
  Transformation,
} from './types'

export interface ChaosChessGameOptions {
  fen?: string
  startFen?: string
  history?: readonly MoveRecord[]
  version?: number
  random?: RandomSource
  transformationConfig?: TransformationConfig
}

function oppositeColor(color: Color): Color {
  return color === 'w' ? 'b' : 'w'
}

function drawStatus(reason: DrawReason): GameStatus {
  return { kind: 'draw', reason }
}

export class ChaosChessGame {
  private chess: Chess
  private readonly random: RandomSource
  private readonly transformationConfig: TransformationConfig
  private readonly positionTracker: PositionTracker
  private readonly moveHistory: MoveRecord[]
  private currentVersion: number

  constructor(options: ChaosChessGameOptions = {}) {
    this.chess = new Chess(options.fen)
    this.random = options.random ?? Math.random
    this.transformationConfig =
      options.transformationConfig ?? GAME_CONFIG.transformation

    const history = options.history ?? []
    const lastRecord = history[history.length - 1]
    if (history.length > 0) {
      if (!options.fen || !options.startFen) {
        throw new Error('Restored games require both fen and startFen.')
      }
      if (lastRecord?.fen !== this.chess.fen()) {
        throw new Error('Stored history does not match the supplied position.')
      }
    }

    this.moveHistory = [...history]
    this.currentVersion = options.version ?? this.moveHistory.length

    this.positionTracker = new PositionTracker(
      options.startFen ?? this.chess.fen(),
    )
    for (const record of this.moveHistory) {
      this.positionTracker.record(record.fen)
    }
  }

  get turn(): Color {
    return this.chess.turn()
  }

  get fen(): string {
    return this.chess.fen()
  }

  get history(): readonly MoveRecord[] {
    return this.moveHistory
  }

  get status(): GameStatus {
    return this.computeStatus()
  }

  get isFinished(): boolean {
    return this.computeStatus().kind !== 'active'
  }

  legalMovesFrom(square: Square): LegalMove[] {
    if (this.isFinished) {
      return []
    }
    return legalMovesFor(this.chess, square)
  }

  move(
    from: Square,
    to: Square,
    promotion?: PromotionPiece,
  ): MoveRecord {
    const status = this.computeStatus()
    if (status.kind !== 'active') {
      throw new ChessRuleError('game-over', 'The game is already over.')
    }

    const piece = this.chess.get(from)
    if (!piece) {
      throw new ChessRuleError('no-piece', 'There is no piece on that square.')
    }
    if (piece.color !== this.chess.turn()) {
      throw new ChessRuleError('wrong-turn', 'It is not that side’s turn.')
    }

    const matchingMoves = this.chess
      .moves({ square: from, verbose: true })
      .filter((candidate) => candidate.to === to)

    if (matchingMoves.length === 0) {
      throw new ChessRuleError('illegal-move', 'That move is not legal.')
    }

    const allowedPromotions = new Set<PromotionPiece>(
      matchingMoves.flatMap((candidate) =>
        candidate.promotion
          ? [candidate.promotion as PromotionPiece]
          : [],
      ),
    )

    if (allowedPromotions.size > 0 && !promotion) {
      throw new ChessRuleError(
        'promotion-required',
        'Choose a promotion piece for this move.',
      )
    }
    if (promotion && !allowedPromotions.has(promotion)) {
      throw new ChessRuleError(
        'invalid-promotion',
        'That promotion choice is not valid for this move.',
      )
    }

    const beforeFen = this.chess.fen()
    let applied: Move
    try {
      applied = this.chess.move({
        from,
        to,
        ...(promotion ? { promotion } : {}),
      })
    } catch {
      this.chess = new Chess(beforeFen)
      throw new ChessRuleError('illegal-move', 'That move is not legal.')
    }

    let transformation: Transformation | null = null
    try {
      const movedPiece = this.chess.get(to)
      if (!movedPiece) {
        throw new Error('The moved piece is missing from its destination.')
      }

      if (movedPiece.type !== 'k') {
        const transformedType = chooseTransformation(
          movedPiece.type,
          to,
          this.random,
          this.transformationConfig,
        )

        if (
          transformedType === movedPiece.type ||
          (transformedType === 'p' &&
            this.transformationConfig.pawnForbiddenRanks.includes(
              squareRank(to),
            ))
        ) {
          throw new Error('The chosen transformation is not legal.')
        }

        const transformedFen = replacePieceInFen(
          this.chess.fen(),
          to,
          { type: transformedType, color: movedPiece.color },
          // A transformed pawn is no longer a pawn, so no en passant right can remain.
          { clearEnPassant: true },
        )
        const transformedChess = new Chess(transformedFen)
        const persistedPiece = transformedChess.get(to)

        if (
          !persistedPiece ||
          persistedPiece.type !== transformedType ||
          persistedPiece.color !== movedPiece.color
        ) {
          throw new Error('The transformed position could not be represented.')
        }

        this.chess = transformedChess
        transformation = {
          from: movedPiece.type,
          to: transformedType,
        }
      }
    } catch {
      this.chess = new Chess(beforeFen)
      throw new ChessRuleError(
        'invalid-transformation',
        'The transformed position could not be represented safely.',
      )
    }

    const finalFen = this.chess.fen()
    const record: MoveRecord = {
      ply: this.moveHistory.length + 1,
      color: applied.color,
      san: applied.san,
      from: applied.from,
      to: applied.to,
      captured: applied.captured ?? null,
      promotion: (applied.promotion as PromotionPiece | undefined) ?? null,
      transformation,
      fen: finalFen,
    }

    this.moveHistory.push(record)
    this.positionTracker.record(finalFen)
    this.currentVersion += 1

    return record
  }

  snapshot(): GameSnapshot {
    const status = this.computeStatus()
    const lastMove = this.moveHistory[this.moveHistory.length - 1]
    const board: Board = this.chess
      .board()
      .map((row) => row.map((cell) => (cell ? { ...cell } : null)))

    return {
      fen: this.chess.fen(),
      board,
      turn: this.chess.turn(),
      status,
      inCheck: this.chess.isCheck(),
      history: [...this.moveHistory],
      lastMove: lastMove
        ? { from: lastMove.from, to: lastMove.to }
        : null,
      version: this.currentVersion,
    }
  }

  private computeStatus(): GameStatus {
    // Checkmate wins first; the draw checks then run in a fixed order.
    if (this.chess.isCheckmate()) {
      return {
        kind: 'checkmate',
        winner: oppositeColor(this.chess.turn()),
      }
    }
    if (this.chess.isStalemate()) {
      return drawStatus('stalemate')
    }
    if (this.chess.isInsufficientMaterial()) {
      return drawStatus('insufficient-material')
    }
    if (this.chess.isDrawByFiftyMoves()) {
      return drawStatus('fifty-move-rule')
    }
    if (this.positionTracker.count(this.chess.fen()) >= 3) {
      return drawStatus('threefold-repetition')
    }

    return { kind: 'active', inCheck: this.chess.isCheck() }
  }
}

export function legalMovesFor(chess: Chess, square: Square): LegalMove[] {
  const grouped = new Map<
    Square,
    { capture: boolean; promotions: Set<PromotionPiece> }
  >()

  for (const move of chess.moves({ square, verbose: true })) {
    const entry = grouped.get(move.to) ?? {
      capture: move.captured !== undefined,
      promotions: new Set<PromotionPiece>(),
    }

    if (move.promotion) {
      entry.promotions.add(move.promotion as PromotionPiece)
    }
    grouped.set(move.to, entry)
  }

  return [...grouped.entries()].map(([to, entry]) => ({
    to,
    capture: entry.capture,
    promotions: PROMOTION_PIECES.filter((piece) =>
      entry.promotions.has(piece),
    ),
  }))
}

export function pieceAt(
  board: Board,
  square: Square,
): { type: PieceSymbol; color: Color; square: Square } | null {
  for (const row of board) {
    for (const cell of row) {
      if (cell?.square === square) {
        return cell
      }
    }
  }
  return null
}
