import type { Color, Square } from 'chess.js'
import { useEffect, useMemo, useState } from 'react'
import { legalMovesFor, pieceAt } from '../game/ChaosChessGame'
import type { LegalMove, PromotionPiece } from '../game/types'
import { ChessBoard } from '../ui/ChessBoard'
import { MoveHistory } from '../ui/MoveHistory'
import { PromotionDialog } from '../ui/PromotionDialog'
import { TransformationSummary } from '../ui/TransformationSummary'
import { statusCopy, type StatusCopy } from '../ui/statusCopy'
import { newRequestId, OnlineError, submitMove } from './api'
import { buildMatchView } from './matchView'
import {
  describeEndReason,
  sideForUid,
  sideToColor,
  type MatchSide,
  type PublicMatch,
} from './types'

interface OnlineGameProps {
  matchId: string
  match: PublicMatch
  uid: string
  onExit: () => void
}

function outcomeHeadline(
  match: PublicMatch,
  mySide: MatchSide | null,
): string {
  if (!match.winnerUid) {
    return 'Draw'
  }
  const winnerSide: MatchSide =
    match.winnerUid === match.playerWhiteUid ? 'white' : 'black'
  if (!mySide) {
    return `${winnerSide === 'white' ? 'White' : 'Black'} wins`
  }
  return winnerSide === mySide ? 'You win' : 'You lose'
}

export function OnlineGame({
  matchId,
  match,
  uid,
  onExit,
}: OnlineGameProps) {
  const mySide = sideForUid(match, uid)
  const myColor: Color | null = mySide ? sideToColor(mySide) : null
  const view = useMemo(() => buildMatchView(match), [match])

  const [selected, setSelected] = useState<Square | null>(null)
  const [legalMoves, setLegalMoves] = useState<readonly LegalMove[]>([])
  const [promotion, setPromotion] = useState<{
    from: Square
    to: Square
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  // Every server-confirmed move replaces this state, so drop any stale
  // local selection when a new version arrives.
  useEffect(() => {
    setSelected(null)
    setLegalMoves([])
    setPromotion(null)
  }, [match.version])

  const copy: StatusCopy = view.gameStatus
    ? statusCopy(view.gameStatus, view.chess.turn())
    : {
        headline: `Match over — ${describeEndReason(match.endReason)}`,
        detail: 'The server ended this match. The final position is below.',
        tone: 'finished',
      }

  const isMyTurn = mySide !== null && match.currentTurn === mySide
  const interactive =
    match.status === 'active' && isMyTurn && !pending && promotion === null
  const finished = match.status === 'finished'

  function clearSelection() {
    setSelected(null)
    setLegalMoves([])
  }

  async function sendMove(
    from: Square,
    to: Square,
    promotionPiece?: PromotionPiece,
  ) {
    setPending(true)
    setError(null)
    try {
      await submitMove({
        matchId,
        requestId: newRequestId(),
        from,
        to,
        promotion: promotionPiece,
        expectedVersion: match.version,
      })
    } catch (caught) {
      setError(
        caught instanceof OnlineError
          ? caught.message
          : 'That move could not be completed.',
      )
    } finally {
      setPending(false)
      setPromotion(null)
      clearSelection()
    }
  }

  function handleSquareClick(square: Square) {
    setError(null)

    if (!interactive || !myColor) {
      return
    }

    const clickedPiece = pieceAt(view.board, square)

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
        void sendMove(selected, square)
        return
      }

      if (clickedPiece && clickedPiece.color === myColor) {
        setSelected(square)
        setLegalMoves(legalMovesFor(view.chess, square))
      } else {
        clearSelection()
      }
      return
    }

    if (clickedPiece && clickedPiece.color === myColor) {
      setSelected(square)
      setLegalMoves(legalMovesFor(view.chess, square))
    }
  }

  return (
    <>
      <main className="layout">
        <section className="board-column">
          {finished && (
            <div className="end-banner">
              <div>
                <p className="status-label">Match over</p>
                <h2 className="status-headline">
                  {outcomeHeadline(match, mySide)}
                </h2>
                <p className="status-detail">
                  {describeEndReason(match.endReason)} · The final position is
                  below.
                </p>
              </div>
              <button
                type="button"
                className="new-game-button"
                onClick={onExit}
              >
                Back to lobby
              </button>
            </div>
          )}

          <div className={`status-bar status-${copy.tone}`} aria-live="polite">
            <div>
              <p className="status-label">Status</p>
              <h2 className="status-headline">{copy.headline}</h2>
              <p className="status-detail">
                {pending ? 'Sending your move…' : copy.detail}
              </p>
            </div>
            <div className="side-indicator" aria-label="Sides">
              <span
                className={`side-pill ${
                  match.status === 'active' && match.currentTurn === 'white'
                    ? 'is-active'
                    : ''
                }`}
              >
                <span
                  className="side-swatch side-swatch-white"
                  aria-hidden="true"
                />
                White
                {mySide === 'white' && <em className="you-tag">you</em>}
              </span>
              <span className="side-divider" aria-hidden="true">
                /
              </span>
              <span
                className={`side-pill ${
                  match.status === 'active' && match.currentTurn === 'black'
                    ? 'is-active'
                    : ''
                }`}
              >
                <span
                  className="side-swatch side-swatch-black"
                  aria-hidden="true"
                />
                Black
                {mySide === 'black' && <em className="you-tag">you</em>}
              </span>
            </div>
          </div>

          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}

          <ChessBoard
            board={view.board}
            turn={view.chess.turn()}
            selected={selected}
            legalMoves={legalMoves}
            lastMove={match.lastMove}
            inCheck={view.chess.isCheck()}
            interactive={interactive}
            onSquareClick={handleSquareClick}
          />

          <p className="board-hint">
            {finished
              ? 'The match is complete. Start another room to play again.'
              : isMyTurn
                ? 'Your move. The server validates the move and chooses the transformation.'
                : 'Waiting for your opponent to move. The board updates live.'}
          </p>
        </section>

        <aside className="sidebar">
          <TransformationSummary history={match.history} />

          <section className="panel history-panel">
            <div className="panel-heading">
              <h2>Moves</h2>
              <span className="panel-count">
                {match.history.length}{' '}
                {match.history.length === 1 ? 'ply' : 'plies'}
              </span>
            </div>
            <MoveHistory history={match.history} />
          </section>

          <section className="panel note-panel">
            <p className="note-label">Match</p>
            <p>
              Room {match.roomCode} · state version {match.version}. Every
              move is validated on the server, so both boards stay identical.
            </p>
            <button
              type="button"
              className="text-button"
              onClick={onExit}
            >
              Leave match
            </button>
          </section>
        </aside>
      </main>

      {promotion && (
        <PromotionDialog
          color={myColor ?? 'w'}
          onSelect={(piece) =>
            void sendMove(promotion.from, promotion.to, piece)
          }
          onCancel={() => {
            setPromotion(null)
            clearSelection()
          }}
        />
      )}
    </>
  )
}
