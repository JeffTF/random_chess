import type { Square } from 'chess.js'
import { useState } from 'react'
import { ChaosChessGame, pieceAt } from '../game/ChaosChessGame'
import { ChessRuleError } from '../game/errors'
import type { GameSnapshot, LegalMove, PromotionPiece } from '../game/types'
import { ChessBoard } from './ChessBoard'
import { MoveHistory } from './MoveHistory'
import { PromotionDialog } from './PromotionDialog'
import { TransformationSummary } from './TransformationSummary'
import { statusCopy } from './statusCopy'

export function LocalGameScreen({
  onPlayOnline,
  onShowEvents,
}: {
  onPlayOnline: () => void
  onShowEvents: () => void
}) {
  const [game, setGame] = useState(() => new ChaosChessGame())
  const [snapshot, setSnapshot] = useState<GameSnapshot>(() =>
    game.snapshot(),
  )
  const [selected, setSelected] = useState<Square | null>(null)
  const [legalMoves, setLegalMoves] = useState<readonly LegalMove[]>([])
  const [promotion, setPromotion] = useState<{
    from: Square
    to: Square
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const copy = statusCopy(snapshot.status, snapshot.turn)
  const gameIsActive = snapshot.status.kind === 'active'
  const interactive = gameIsActive && promotion === null

  function clearSelection() {
    setSelected(null)
    setLegalMoves([])
  }

  function selectSquare(square: Square) {
    setSelected(square)
    setLegalMoves(game.legalMovesFrom(square))
  }

  function commitMove(
    from: Square,
    to: Square,
    promotionPiece?: PromotionPiece,
  ) {
    try {
      game.move(from, to, promotionPiece)
      setSnapshot(game.snapshot())
      setPromotion(null)
      clearSelection()
      setError(null)
    } catch (caught) {
      setSnapshot(game.snapshot())
      setPromotion(null)
      clearSelection()
      setError(
        caught instanceof ChessRuleError
          ? caught.message
          : 'That move could not be completed.',
      )
    }
  }

  function handleSquareClick(square: Square) {
    setError(null)

    if (!interactive) {
      return
    }

    const clickedPiece = pieceAt(snapshot.board, square)

    if (selected) {
      if (selected === square) {
        clearSelection()
        return
      }

      const target = legalMoves.find((move) => move.to === square)
      if (target) {
        if (target.promotions.length > 0) {
          setPromotion({ from: selected, to: square })
          return
        }

        commitMove(selected, square)
        return
      }

      if (clickedPiece && clickedPiece.color === snapshot.turn) {
        selectSquare(square)
      } else {
        clearSelection()
      }
      return
    }

    if (clickedPiece && clickedPiece.color === snapshot.turn) {
      selectSquare(square)
    }
  }

  function resetGame() {
    const nextGame = new ChaosChessGame()
    setGame(nextGame)
    setSnapshot(nextGame.snapshot())
    clearSelection()
    setPromotion(null)
    setError(null)
  }

  const promotionColor = promotion
    ? (pieceAt(snapshot.board, promotion.from)?.color ?? snapshot.turn)
    : snapshot.turn

  return (
    <div className="app">
      <header className="masthead">
        <div className="brand">
          <p className="eyebrow">
            <span className="eyebrow-mark" aria-hidden="true" />
            Local hotseat
          </p>
          <h1>Chaos Chess</h1>
          <p className="tagline">
            Every non-king move rewrites the piece that made it.
          </p>
        </div>
        <div className="masthead-actions">
          <button
            type="button"
            className="new-game-button"
            onClick={onShowEvents}
          >
            All events
          </button>
          <button
            type="button"
            className="new-game-button"
            onClick={onPlayOnline}
          >
            Play online
          </button>
          <button
            type="button"
            className="new-game-button"
            onClick={resetGame}
          >
            New game
          </button>
        </div>
      </header>

      <main className="layout">
        <section className="board-column">
          <div
            className={`status-bar status-${copy.tone}`}
            aria-live="polite"
          >
            <div>
              <p className="status-label">Status</p>
              <h2 className="status-headline">{copy.headline}</h2>
              <p className="status-detail">{copy.detail}</p>
            </div>
            <div className="side-indicator" aria-label="Sides">
              <span
                className={`side-pill ${
                  gameIsActive && snapshot.turn === 'w' ? 'is-active' : ''
                }`}
              >
                <span
                  className="side-swatch side-swatch-white"
                  aria-hidden="true"
                />
                White
              </span>
              <span className="side-divider" aria-hidden="true">
                /
              </span>
              <span
                className={`side-pill ${
                  gameIsActive && snapshot.turn === 'b' ? 'is-active' : ''
                }`}
              >
                <span
                  className="side-swatch side-swatch-black"
                  aria-hidden="true"
                />
                Black
              </span>
            </div>
          </div>

          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}

          <ChessBoard
            board={snapshot.board}
            turn={snapshot.turn}
            selected={selected}
            legalMoves={legalMoves}
            lastMove={snapshot.lastMove}
            inCheck={snapshot.inCheck}
            interactive={interactive}
            onSquareClick={handleSquareClick}
          />

          <p className="board-hint">
            {gameIsActive
              ? 'Promotion is resolved before the piece transforms. Castling, check, checkmate, and draws use standard chess rules.'
              : 'The game is complete. Start a new game to play again.'}
          </p>
        </section>

        <aside className="sidebar">
          <TransformationSummary history={snapshot.history} />

          <section className="panel history-panel">
            <div className="panel-heading">
              <h2>Moves</h2>
              <span className="panel-count">
                {snapshot.history.length}{' '}
                {snapshot.history.length === 1 ? 'ply' : 'plies'}
              </span>
            </div>
            <MoveHistory history={snapshot.history} />
          </section>

          <section className="panel note-panel">
            <p className="note-label">Scope</p>
            <p>
              Local hotseat practice. HP tracking and random events only
              happen in online matches.
            </p>
          </section>
        </aside>
      </main>

      {promotion && (
        <PromotionDialog
          color={promotionColor}
          onSelect={(piece) =>
            commitMove(promotion.from, promotion.to, piece)
          }
          onCancel={() => {
            setPromotion(null)
            clearSelection()
          }}
        />
      )}
    </div>
  )
}
