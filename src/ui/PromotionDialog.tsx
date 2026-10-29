import type { Color } from 'chess.js'
import { useEffect } from 'react'
import { PROMOTION_PIECES } from '../game/config'
import type { PromotionPiece } from '../game/types'
import { PIECE_GLYPHS, colorName, pieceName } from './pieceDisplay'

interface PromotionDialogProps {
  color: Color
  onSelect: (piece: PromotionPiece) => void
  onCancel: () => void
}

export function PromotionDialog({
  color,
  onSelect,
  onCancel,
}: PromotionDialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onCancel()
        }
      }}
    >
      <div
        className="promotion-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="promotion-title"
      >
        <p className="eyebrow">Pawn promotion</p>
        <h2 id="promotion-title">Choose a promotion piece</h2>
        <p className="dialog-copy">
          Your {colorName(color).toLowerCase()} pawn reached the last rank.
          It will transform once more after you choose.
        </p>
        <div className="promotion-options">
          {PROMOTION_PIECES.map((piece) => (
            <button
              key={piece}
              type="button"
              className="promotion-option"
              onClick={() => onSelect(piece)}
              autoFocus={piece === 'q'}
              aria-label={`Promote to ${pieceName(piece)}`}
            >
              <span
                className={`promotion-glyph piece-${color}`}
                aria-hidden="true"
              >
                {PIECE_GLYPHS[piece]}
              </span>
              <span>{pieceName(piece)}</span>
            </button>
          ))}
        </div>
        <button type="button" className="text-button" onClick={onCancel}>
          Cancel move
        </button>
      </div>
    </div>
  )
}
