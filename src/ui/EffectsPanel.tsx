import type { BoardEffects } from '../game/types'
import { EVENT_CATALOGUE_BY_KIND } from '../game/events'
import type { EventSummary } from '../online/types'

interface EffectsPanelProps {
  effects: BoardEffects
  lastEvent: EventSummary | null
  uid: string
}

function summaryLine(summary: EventSummary, uid: string): string {
  const name = EVENT_CATALOGUE_BY_KIND[summary.kind].name
  const actor =
    summary.byUid === null
      ? 'Event'
      : summary.byUid === uid
        ? 'You'
        : 'Your opponent'
  if (summary.outcome === 'accepted') {
    return `${name} — ${actor} paid and activated it.`
  }
  if (summary.outcome === 'declined') {
    return `${name} — ${actor === 'You' ? 'you' : 'your opponent'} declined.`
  }
  return `${name} — the offer timed out.`
}

export function EffectsPanel({ effects, lastEvent, uid }: EffectsPanelProps) {
  const activeCount =
    effects.bombs.length + effects.shields.length + (effects.hijack ? 1 : 0)

  return (
    <section className="panel effects-panel">
      <div className="panel-heading">
        <h2>Chaos effects</h2>
        <span className="panel-count">
          {activeCount === 1 ? '1 active' : `${activeCount} active`}
        </span>
      </div>

      {effects.bombs.length > 0 && (
        <ul className="effect-list">
          {effects.bombs.map((bomb) => (
            <li key={`bomb-${bomb.square}`} className="effect-row">
              <span
                className={`effect-mark effect-mark-bomb effect-mark-${bomb.kind}`}
                aria-hidden="true"
              />
              <span>
                <strong>{bomb.square}</strong>{' '}
                {bomb.kind === 'triple'
                  ? `triple bomb (${bomb.movesLeft ?? 0} ${
                      bomb.movesLeft === 1 ? 'move' : 'moves'
                    } left)`
                  : 'friendly bomb'}
                <span className="effect-owner">
                  {' '}
                  · {bomb.side === 'white' ? 'White' : 'Black'} piece
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {effects.shields.length > 0 && (
        <ul className="effect-list">
          {effects.shields.map((shield) => (
            <li key={`shield-${shield.square}`} className="effect-row">
              <span
                className="effect-mark effect-mark-shield"
                aria-hidden="true"
              />
              <span>
                <strong>{shield.square}</strong> shielded
                <span className="effect-owner">
                  {' '}
                  · {shield.side === 'white' ? 'White' : 'Black'} piece
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {effects.hijack && (
        <p className="effect-hijack">
          {effects.hijack.byUid === uid
            ? 'Hijack armed by you: your opponent’s next non-king move joins your side.'
            : 'Opponent hijack armed: your next non-king move joins their side. King moves use it up safely.'}
        </p>
      )}

      {activeCount === 0 && (
        <p className="effect-empty">No bombs, shields, or hijacks in play.</p>
      )}

      {lastEvent && <p className="effect-last">{summaryLine(lastEvent, uid)}</p>}
    </section>
  )
}
