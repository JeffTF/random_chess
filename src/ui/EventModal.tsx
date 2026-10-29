import { useEffect, useMemo, useRef, useState } from 'react'
import type { Color, Square } from 'chess.js'
import type { EventDefinition } from '../game/events'
import type { Board, BoardSquare } from '../game/types'
import type { BoardEffects, EventOffer } from '../online/types'
import { PIECE_GLYPHS, pieceName } from './pieceDisplay'

interface EventModalProps {
  offer: EventOffer
  definition: EventDefinition
  hp: number | null
  myColor: Color
  board: Board
  effects: BoardEffects
  pending: boolean
  onAccept: (square?: Square) => void
  onDecline: () => void
  onExpire: () => void
}

export function EventModal({
  offer,
  definition,
  hp,
  myColor,
  board,
  effects,
  pending,
  onAccept,
  onDecline,
  onExpire,
}: EventModalProps) {
  const totalMs = Math.max(offer.expiresAtMs - offer.createdAtMs, 1)
  const [remainingMs, setRemainingMs] = useState(() =>
    Math.max(offer.expiresAtMs - Date.now(), 0),
  )
  const [selected, setSelected] = useState<Square | null>(null)
  const expiredRef = useRef(false)
  const onExpireRef = useRef(onExpire)
  onExpireRef.current = onExpire

  useEffect(() => {
    expiredRef.current = false
    setSelected(null)
    setRemainingMs(Math.max(offer.expiresAtMs - Date.now(), 0))

    const timer = window.setInterval(() => {
      const next = Math.max(offer.expiresAtMs - Date.now(), 0)
      setRemainingMs(next)
      if (next === 0 && !expiredRef.current) {
        expiredRef.current = true
        window.clearInterval(timer)
        onExpireRef.current()
      }
    }, 250)

    return () => window.clearInterval(timer)
  }, [offer.id, offer.expiresAtMs])

  const selectable = useMemo<BoardSquare[]>(() => {
    if (definition.pieceTarget === null) {
      return []
    }
    const targetColor: Color =
      definition.pieceTarget === 'own'
        ? myColor
        : myColor === 'w'
          ? 'b'
          : 'w'
    const unavailable = new Set<Square>()
    if (definition.pieceTarget === 'own') {
      if (definition.kind === 'protect-piece') {
        for (const marker of effects.shields) {
          unavailable.add(marker.square)
        }
      }
      if (definition.kind === 'friendly-bomb') {
        for (const marker of effects.bombs) {
          unavailable.add(marker.square)
        }
      }
    }

    return board
      .flat()
      .filter(
        (cell): cell is BoardSquare =>
          cell !== null &&
          cell.color === targetColor &&
          cell.type !== 'k' &&
          !unavailable.has(cell.square),
      )
  }, [board, definition, effects, myColor])

  const needsPiece = definition.pieceTarget !== null
  const affordable = hp !== null && hp >= offer.cost
  const canAccept =
    !pending && affordable && (!needsPiece || selected !== null)
  const seconds = Math.ceil(remainingMs / 1000)
  const barPercent = Math.round((remainingMs / totalMs) * 100)

  return (
    <div className="modal-backdrop">
      <div
        className="event-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-title"
      >
        <p className="note-label">Chaos event · {offer.cost} HP</p>
        <h2 id="event-title">{definition.name}</h2>
        <p className="dialog-copy">{definition.description}</p>

        <div className="event-timer" aria-hidden="true">
          <span
            className="event-timer-fill"
            style={{ width: `${barPercent}%` }}
          />
        </div>
        <p className="event-timer-copy" aria-live="polite">
          {seconds > 0
            ? `Auto-declines in ${seconds}s`
            : 'Resolving the timeout…'}
        </p>

        <div className="event-cost-row">
          <span>Your HP</span>
          <strong>{hp === null ? '—' : hp}</strong>
        </div>
        <div className="event-cost-row">
          <span>Cost</span>
          <strong>{offer.cost === 0 ? 'None' : `−${offer.cost} HP`}</strong>
        </div>
        {!affordable && (
          <p className="event-warning">
            You do not have enough HP to accept this event. Declining is free.
          </p>
        )}
        {offer.cost > 0 && affordable && hp !== null && hp === offer.cost && (
          <p className="event-warning">
            Paying this cost would leave you at 0 HP and end the match.
          </p>
        )}

        {needsPiece && (
          <div className="event-picker">
            <p className="event-picker-label">
              {definition.pieceTarget === 'own'
                ? 'Choose one of your pieces'
                : 'Choose an opponent piece'}
            </p>
            {selectable.length === 0 ? (
              <p className="event-warning">
                No eligible piece is available. Decline to continue.
              </p>
            ) : (
              <div className="event-piece-grid">
                {selectable.map((cell) => (
                  <button
                    key={cell.square}
                    type="button"
                    className={`event-piece ${
                      selected === cell.square ? 'is-selected' : ''
                    }`}
                    onClick={() =>
                      setSelected((current) =>
                        current === cell.square ? null : cell.square,
                      )
                    }
                    aria-pressed={selected === cell.square}
                    disabled={pending}
                  >
                    <span
                      className={`mini-glyph piece-${cell.color}`}
                      aria-hidden="true"
                    >
                      {PIECE_GLYPHS[cell.type]}
                    </span>
                    <span className="event-piece-label">
                      {cell.square} {pieceName(cell.type)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="event-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => onAccept(selected ?? undefined)}
            disabled={!canAccept}
          >
            {pending ? 'Sending…' : 'Accept & pay'}
          </button>
          <button
            type="button"
            className="text-button"
            onClick={onDecline}
            disabled={pending}
          >
            Decline
          </button>
        </div>
        <p className="event-fine-print">
          The server rolls all randomness and applies the effect. Your
          opponent never sees your exact HP.
        </p>
      </div>
    </div>
  )
}
