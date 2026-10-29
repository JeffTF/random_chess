import type { Color, PieceSymbol, Square } from 'chess.js'

export type PieceType = PieceSymbol
export type TransformablePieceType = Exclude<PieceSymbol, 'k'>
export type PromotionPiece = 'q' | 'r' | 'b' | 'n'

export type RandomSource = () => number

export interface Transformation {
  from: TransformablePieceType
  to: TransformablePieceType
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
