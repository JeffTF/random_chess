import type { Color, Square } from 'chess.js'
import type { Board, BoardEffects, LegalMove } from '../game/types'
import { PIECE_GLYPHS, colorName, pieceName } from './pieceDisplay'

interface ChessBoardProps {
  board: Board
  turn: Color
  selected: Square | null
  legalMoves: readonly LegalMove[]
  lastMove: { from: Square; to: Square } | null
  inCheck: boolean
  interactive: boolean
  effects?: BoardEffects | null
  onSquareClick: (square: Square) => void
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const

export function ChessBoard({
  board,
  turn,
  selected,
  legalMoves,
  lastMove,
  inCheck,
  interactive,
  effects = null,
  onSquareClick,
}: ChessBoardProps) {
  const targets = new Map(legalMoves.map((move) => [move.to, move]))

  return (
    <div className="board-frame">
      <div className="board" aria-label="Chess board">
        {board.map((row, rowIndex) =>
          row.map((cell, columnIndex) => {
            const square = `${FILES[columnIndex]}${8 - rowIndex}` as Square
            const target = targets.get(square)
            const isSelected = selected === square
            const isLastMove =
              lastMove?.from === square || lastMove?.to === square
            const isCheckedKing =
              inCheck && cell?.type === 'k' && cell.color === turn
            const bomb = effects?.bombs.find(
              (marker) => marker.square === square,
            )
            const shield = effects?.shields.find(
              (marker) => marker.square === square,
            )

            const classes = [
              'square',
              (rowIndex + columnIndex) % 2 === 0
                ? 'square-light'
                : 'square-dark',
              isSelected ? 'is-selected' : '',
              isLastMove ? 'is-last-move' : '',
              isCheckedKing ? 'is-check' : '',
              target ? 'is-target' : '',
              target?.capture ? 'is-capture' : '',
            ]
              .filter(Boolean)
              .join(' ')

            const pieceDescription = cell
              ? `${colorName(cell.color)} ${pieceName(cell.type)}`
              : 'empty'
            const targetDescription = target
              ? `, legal move${target.capture ? ', capture' : ''}`
              : ''
            const selectedDescription = isSelected ? ', selected' : ''
            const bombDescription = bomb
              ? bomb.kind === 'triple'
                ? `, triple bomb, ${bomb.movesLeft ?? 0} moves left`
                : ', friendly bomb'
              : ''
            const shieldDescription = shield ? ', shielded' : ''

            return (
              <button
                key={square}
                type="button"
                className={classes}
                onClick={() => onSquareClick(square)}
                disabled={!interactive}
                aria-label={`${square}, ${pieceDescription}${selectedDescription}${targetDescription}${bombDescription}${shieldDescription}`}
              >
                {columnIndex === 0 && (
                  <span className="coordinate rank-coordinate">
                    {8 - rowIndex}
                  </span>
                )}
                {rowIndex === 7 && (
                  <span className="coordinate file-coordinate">
                    {FILES[columnIndex]}
                  </span>
                )}
                {cell && (
                  <span
                    className={`piece piece-${cell.color}`}
                    aria-hidden="true"
                  >
                    {PIECE_GLYPHS[cell.type]}
                  </span>
                )}
                {bomb && (
                  <span
                    className={`marker marker-bomb marker-bomb-${bomb.kind}`}
                    aria-hidden="true"
                  >
                    {bomb.kind === 'triple' ? (
                      <span className="marker-count">
                        {bomb.movesLeft ?? 0}
                      </span>
                    ) : null}
                  </span>
                )}
                {shield && (
                  <span className="marker marker-shield" aria-hidden="true" />
                )}
              </button>
            )
          }),
        )}
      </div>
    </div>
  )
}
