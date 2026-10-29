import type { Color, Square } from 'chess.js'
import { useState } from 'react'
import { ChaosChessGame, pieceAt } from './game/ChaosChessGame'
import { ChessRuleError } from './game/errors'
import type {
  GameSnapshot,
  GameStatus,
  LegalMove,
  MoveRecord,
  PromotionPiece,
} from './game/types'
import { ChessBoard } from './ui/ChessBoard'
import { MoveHistory } from './ui/MoveHistory'
import { PromotionDialog } from './ui/PromotionDialog'
import {
  PIECE_GLYPHS,
  colorName,
  drawReasonLabel,
  pieceName,
} from './ui/pieceDisplay'

type StatusTone = 'active' | 'check' | 'finished' | 'draw'

interface StatusCopy {
  headline: string
  detail: string
  tone: StatusTone
}

function statusCopy(status: GameStatus, turn: Color): StatusCopy {
  switch (status.kind) {
    case 'active':
      return status.inCheck
        ? {
            headline: `${colorName(turn)} is in check`,
            detail: 'Find a legal move that gets the king out of danger.',
            tone: 'check',
          }
        : {
            headline: `${colorName(turn)} to move`,
            detail: 'Pick a piece, then choose a highlighted square.',
            tone: 'active',
          }
    case 'checkmate':
      return {
        headline: `Checkmate — ${colorName(status.winner)} wins`,
        detail: `${colorName(turn)} has no legal reply. The game is over.`,
        tone: 'finished',
      }
    case 'draw': {
      const detail =
        status.reason === 'stalemate'
          ? `${colorName(turn)} has no legal moves, but the king is not in check.`
          : status.reason === 'insufficient-material'
            ? 'Neither side has enough material to force checkmate.'
            : status.reason === 'fifty-move-rule'
              ? 'Fifty moves passed without a pawn move or a capture.'
              : 'The same position occurred three times.'

      return {
        headline: `Draw — ${drawReasonLabel(status.reason)}`,
        detail,
        tone: 'draw',
      }
    }
  }
}

function TransformationSummary({
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
            <span
              className={`shift-glyph shift-${lastMove.color}`}
            >
              {PIECE_GLYPHS[lastMove.transformation.from]}
            </span>
            <span className="shift-arrow">→</span>
            <span
              className={`shift-glyph shift-${lastMove.color}`}
            >
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

export default function App() {
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
            Phase 1 · Local hotseat
          </p>
          <h1>Chaos Chess</h1>
          <p className="tagline">
            Every non-king move rewrites the piece that made it.
          </p>
        </div>
        <button type="button" className="new-game-button" onClick={resetGame}>
          New game
        </button>
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
              Local chess core and post-move transformations. HP, random
              events, and online rooms belong to later phases.
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
