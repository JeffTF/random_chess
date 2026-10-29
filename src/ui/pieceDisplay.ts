import type { Color, PieceSymbol } from 'chess.js'
import type { DrawReason } from '../game/types'

export const PIECE_GLYPHS: Record<PieceSymbol, string> = {
  k: '♚',
  q: '♛',
  r: '♜',
  b: '♝',
  n: '♞',
  p: '♟',
}

const PIECE_NAMES: Record<PieceSymbol, string> = {
  k: 'king',
  q: 'queen',
  r: 'rook',
  b: 'bishop',
  n: 'knight',
  p: 'pawn',
}

export function colorName(color: Color): string {
  return color === 'w' ? 'White' : 'Black'
}

export function pieceName(type: PieceSymbol): string {
  return PIECE_NAMES[type]
}

export function drawReasonLabel(reason: DrawReason): string {
  switch (reason) {
    case 'stalemate':
      return 'Stalemate'
    case 'insufficient-material':
      return 'Insufficient material'
    case 'fifty-move-rule':
      return 'Fifty-move rule'
    case 'threefold-repetition':
      return 'Threefold repetition'
  }
}
