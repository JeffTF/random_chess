import type { Color, PieceSymbol, Square } from 'chess.js'

export type PieceType = PieceSymbol
export type TransformablePieceType = Exclude<PieceSymbol, 'k'>
export type PromotionPiece = 'q' | 'r' | 'b' | 'n'

export type RandomSource = () => number

export interface Transformation {
  from: TransformablePieceType
  to: TransformablePieceType
}

export interface MoveEffects {
  /** HP damage dealt to the mover by bombs during this move. */
  bombDamage?: number
  /** The moved piece changed ownership through a hijack. */
  hijacked?: boolean
}

export type BombKind = 'friendly' | 'triple'

/** Public bomb marker; triple bombs expire, friendly bombs do not. */
export interface BombMarker {
  square: Square
  side: 'white' | 'black'
  kind: BombKind
  movesLeft: number | null
}

/** Public shield marker. */
export interface ShieldMarker {
  square: Square
  side: 'white' | 'black'
}

export interface BoardEffects {
  bombs: BombMarker[]
  shields: ShieldMarker[]
  hijack: { byUid: string } | null
}

export interface MoveRecord {
  ply: number
  color: Color
  san: string
  from: Square
  to: Square
  captured: PieceType | null
  promotion: PromotionPiece | null
  transformation: Transformation | null
  /** Server-resolved event effects triggered by this move. */
  effects?: MoveEffects
  fen: string
}

export interface LegalMove {
  to: Square
  capture: boolean
  promotions: PromotionPiece[]
}

export type DrawReason =
  | 'stalemate'
  | 'insufficient-material'
  | 'fifty-move-rule'
  | 'threefold-repetition'

export type GameStatus =
  | { kind: 'active'; inCheck: boolean }
  | { kind: 'checkmate'; winner: Color }
  | { kind: 'draw'; reason: DrawReason }

export interface BoardSquare {
  square: Square
  type: PieceType
  color: Color
}

export type Board = ReadonlyArray<ReadonlyArray<BoardSquare | null>>

export interface GameSnapshot {
  fen: string
  board: Board
  turn: Color
  status: GameStatus
  inCheck: boolean
  history: readonly MoveRecord[]
  lastMove: { from: Square; to: Square } | null
  version: number
}
