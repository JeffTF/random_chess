import type { MoveRecord } from '../game/types'
import { PIECE_GLYPHS, colorName, pieceName } from './pieceDisplay'

export function TransformationSummary({
  history,
}: {
  history: readonly MoveRecord[]
}) {
  const lastMove = history[history.length - 1]

  return (
    <section className="panel shift-panel" aria-live="polite">
      <div className="panel-heading">
        <h2>Latest shift</h2>
        <span className="panel-count">
          {history.length} {history.length === 1 ? 'ply' : 'plies'}
        </span>
      </div>

      {!lastMove && (
        <div className="shift-empty">
          <div className="shift-empty-mark" aria-hidden="true">
            ♟ → ?
          </div>
          <p>The first non-king move will transform its piece.</p>
        </div>
      )}

      {lastMove && !lastMove.transformation && (
        <>
          <div className="shift-display" aria-hidden="true">
            <span className={`shift-glyph shift-${lastMove.color}`}>♚</span>
            <span className="shift-arrow">→</span>
            <span className={`shift-glyph shift-${lastMove.color}`}>♚</span>
          </div>
          <p className="shift-copy">
            Kings are exempt. {colorName(lastMove.color)} moved the king with{' '}
            <span className="san-inline">{lastMove.san}</span>.
          </p>
        </>
      )}

      {lastMove?.transformation && (
        <>
          <div className="shift-display" aria-hidden="true">
            <span className={`shift-glyph shift-${lastMove.color}`}>
              {PIECE_GLYPHS[lastMove.transformation.from]}
            </span>
            <span className="shift-arrow">→</span>
            <span className={`shift-glyph shift-${lastMove.color}`}>
              {PIECE_GLYPHS[lastMove.transformation.to]}
            </span>
          </div>
          <p className="shift-copy">
            <strong>
              {colorName(lastMove.color)}{' '}
              {pieceName(lastMove.transformation.from)}
            </strong>{' '}
            became a <strong>{pieceName(lastMove.transformation.to)}</strong>{' '}
            after <span className="san-inline">{lastMove.san}</span>.
          </p>
        </>
      )}

      <ul className="rule-chips" aria-label="Transformation rules">
        <li>Never the same type</li>
        <li>Kings exempt</li>
        <li>No pawns on rank 1 or 8</li>
      </ul>
    </section>
  )
}
