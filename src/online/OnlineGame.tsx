import type { Color, Square } from 'chess.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { legalMovesFor, pieceAt } from '../game/ChaosChessGame'
import { EVENT_CATALOGUE_BY_KIND } from '../game/events'
import type { LegalMove, PromotionPiece } from '../game/types'
import { ChessBoard } from '../ui/ChessBoard'
import { EffectsPanel } from '../ui/EffectsPanel'
import { EventModal } from '../ui/EventModal'
import { HpPanel } from '../ui/HpPanel'
import { MoveHistory } from '../ui/MoveHistory'
import { PromotionDialog } from '../ui/PromotionDialog'
import { TransformationSummary } from '../ui/TransformationSummary'
import { statusCopy, type StatusCopy } from '../ui/statusCopy'
import {
  newRequestId,
  OnlineError,
  respondToEvent,
  submitMove,
} from './api'
import { buildMatchView } from './matchView'
import {
  describeEndReason,
  sideForUid,
  sideToColor,
  type MatchSide,
  type PublicMatch,
} from './types'
import { usePrivateHp } from './usePrivateHp'

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
  const privateHp = usePrivateHp(matchId, match.version, mySide !== null)

  const [selected, setSelected] = useState<Square | null>(null)
  const [legalMoves, setLegalMoves] = useState<readonly LegalMove[]>([])
  const [promotion, setPromotion] = useState<{
    from: Square
    to: Square
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [eventPending, setEventPending] = useState(false)
  const settlingEventRef = useRef<string | null>(null)

  const offer = match.event
  const eventDefinition = offer ? EVENT_CATALOGUE_BY_KIND[offer.kind] : null
  const offeredToMe =
    offer !== null && mySide !== null && offer.offeredTo === mySide

  // Every server-confirmed move replaces this state, so drop any stale
  // local selection when a new version arrives.
  useEffect(() => {
    setSelected(null)
    setLegalMoves([])
    setPromotion(null)
  }, [match.version])

  useEffect(() => {
    if (!notice) {
      return
    }
    const timer = window.setTimeout(() => setNotice(null), 6000)
    return () => window.clearTimeout(timer)
  }, [notice])

  // Either client may settle an expired offer, so a tab left open keeps the
  // match moving even if the player who was offered the event walks away.
  useEffect(() => {
    if (match.status !== 'event_pending' || !match.event) {
      return
    }
    const eventId = match.event.id
    const remainingMs = match.event.expiresAtMs - Date.now()
    const timer = window.setTimeout(
      () => {
        if (settlingEventRef.current === eventId) {
          return
        }
        settlingEventRef.current = eventId
        respondToEvent({ matchId, eventId, accept: false })
          .catch((caught: unknown) => {
            if (
              caught instanceof OnlineError &&
              caught.reason === 'event-not-pending'
            ) {
              return
            }
            setError(
              'The event expired, but the match could not resume. It will retry on your next move.',
            )
          })
          .finally(() => {
            settlingEventRef.current = null
          })
      },
      Math.max(remainingMs + 500, 500),
    )
    return () => window.clearTimeout(timer)
  }, [match.status, match.event, matchId])

  const copy: StatusCopy =
    match.status === 'event_pending' && offer && eventDefinition
      ? {
          headline: offeredToMe
            ? `Event: ${eventDefinition.name}`
            : `Opponent is deciding: ${eventDefinition.name}`,
          detail: offeredToMe
            ? 'Answer the event to resume the match.'
            : 'The board resumes when they answer or the timer runs out.',
          tone: 'event',
        }
      : view.gameStatus
        ? statusCopy(view.gameStatus, view.chess.turn())
        : {
            headline: `Match over — ${describeEndReason(match.endReason)}`,
            detail: 'The server ended this match. The final position is below.',
            tone: 'finished',
          }

  const isMyTurn = mySide !== null && match.currentTurn === mySide
  const interactive =
    match.status === 'active' &&
    isMyTurn &&
    !pending &&
    !eventPending &&
    promotion === null
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
      const result = await submitMove({
        matchId,
        requestId: newRequestId(),
        from,
        to,
        promotion: promotionPiece,
        expectedVersion: match.version,
      })
      if (result.blocked === 'shield') {
        setNotice(
          'A shield cancelled that capture. The shield is spent; choose another move.',
        )
      }
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

  async function answerEvent(accept: boolean, square?: Square) {
    if (!offer) {
      return
    }
    setEventPending(true)
    setError(null)
    try {
      const result = await respondToEvent({
        matchId,
        eventId: offer.id,
        accept,
        square,
      })
      if (result.hpLoss !== null && result.hpLoss > 0) {
        setNotice(`The shared loss took ${result.hpLoss} HP from you.`)
      } else if (accept && result.outcome === 'accepted') {
        setNotice('Event activated.')
      } else if (result.outcome === 'expired') {
        setNotice('The event timed out and the match resumed.')
      }
    } catch (caught) {
      setError(
        caught instanceof OnlineError
          ? caught.message
          : 'The event could not be answered.',
      )
    } finally {
      setEventPending(false)
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
                {pending
                  ? 'Sending your move…'
                  : eventPending
                    ? 'Sending your answer…'
                    : copy.detail}
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

          {notice && (
            <div className="info-banner" role="status">
              {notice}
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
            effects={match.effects}
            onSquareClick={handleSquareClick}
          />

          <p className="board-hint">
            {finished
              ? 'The match is complete. Start another room to play again.'
              : match.status === 'event_pending'
                ? offeredToMe
                  ? 'Answer the chaos event in the dialog to continue.'
                  : 'Waiting for your opponent to answer the chaos event.'
                : isMyTurn
                  ? 'Your move. The server validates the move and chooses the transformation.'
                  : 'Waiting for your opponent to move. The board updates live.'}
          </p>
        </section>

        <aside className="sidebar">
          <HpPanel hp={privateHp.hp} side={mySide} error={privateHp.error} />

          <EffectsPanel
            effects={match.effects}
            lastEvent={match.lastEvent}
            uid={uid}
          />

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

      {offer &&
        eventDefinition &&
        offeredToMe &&
        match.status === 'event_pending' && (
          <EventModal
            offer={offer}
            definition={eventDefinition}
            hp={privateHp.hp}
            myColor={myColor ?? 'w'}
            board={view.board}
            effects={match.effects}
            pending={eventPending}
            onAccept={(square) => void answerEvent(true, square)}
            onDecline={() => void answerEvent(false)}
            onExpire={() => void answerEvent(false)}
          />
        )}
    </>
  )
}
