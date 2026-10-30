import {
  EVENT_CATALOGUE,
  EVENT_TUNING,
  type EventDefinition,
} from '../game/events'

function targetCopy(definition: EventDefinition): string {
  if (definition.pieceTarget === 'own') {
    return 'You choose one of your pieces.'
  }
  if (definition.pieceTarget === 'opponent') {
    return 'You choose one of your opponent’s pieces.'
  }
  return 'The server chooses the targets.'
}

export function EventsScreen({ onBack }: { onBack: () => void }) {
  const seconds = Math.round(EVENT_TUNING.responseTimeoutMs / 1000)

  return (
    <div className="app">
      <header className="masthead">
        <div className="brand">
          <p className="eyebrow">
            <span className="eyebrow-mark" aria-hidden="true" />
            Event catalogue
          </p>
          <h1>Chaos events</h1>
          <p className="tagline">
            Every option the server can offer, what it costs, and what it does
            to the board.
          </p>
        </div>
        <div className="masthead-actions">
          <button type="button" className="new-game-button" onClick={onBack}>
            Back
          </button>
        </div>
      </header>

      <main className="events-main">
        <section className="panel events-intro">
          <p className="note-label">How offers work</p>
          <p className="online-note">
            After a non-king move resolves, the server may offer one event to
            the player who moved or to their opponent. Accepting pays the cost
            in HP immediately; declining or letting the {seconds}-second timer
            run out is free. Randomness (targets, damage rolls, which event
            appears) is always rolled on the server.
          </p>
        </section>

        <div className="events-grid">
          {EVENT_CATALOGUE.map((definition) => (
            <article className="panel event-card" key={definition.kind}>
              <div className="event-card-heading">
                <h2>{definition.name}</h2>
                <span className="event-cost">
                  {definition.cost === 0 ? 'Free' : `${definition.cost} HP`}
                </span>
              </div>
              <p className="event-card-copy">{definition.description}</p>
              <p className="event-card-meta">{targetCopy(definition)}</p>
            </article>
          ))}
        </div>
      </main>
    </div>
  )
}
