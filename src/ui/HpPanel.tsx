import { GAME_CONFIG } from '../game/config'

interface HpPanelProps {
  hp: number | null
  side: 'white' | 'black' | null
  error: string | null
}

export function HpPanel({ hp, side, error }: HpPanelProps) {
  const maxHp = GAME_CONFIG.hp.max
  const capped = hp === null ? 0 : Math.min(maxHp, Math.max(0, hp))
  const percent = (capped / maxHp) * 100
  const sideLabel =
    side === 'white' ? 'White' : side === 'black' ? 'Black' : 'Unassigned'

  return (
    <section className="panel hp-panel" aria-label="Hit points">
      <div className="panel-heading">
        <h2>Vitals</h2>
        <span className="panel-count">{maxHp} max</span>
      </div>

      <div className="hp-row">
        <div className="hp-head">
          <span>
            You · {sideLabel}
          </span>
          <span className="hp-value">
            {hp === null ? '—' : `${hp} / ${maxHp}`}
          </span>
        </div>
        <div
          className="hp-track"
          role="progressbar"
          aria-label="Your HP"
          aria-valuemin={0}
          aria-valuemax={maxHp}
          aria-valuenow={capped}
          aria-valuetext={
            hp === null ? 'Loading your HP' : `${hp} of ${maxHp} HP`
          }
        >
          <span className="hp-fill" style={{ width: `${percent}%` }} />
        </div>
      </div>

      <div className="hp-row">
        <div className="hp-head">
          <span>Opponent</span>
          <span className="hp-value hp-hidden">Hidden</span>
        </div>
        <div className="hp-track hp-track-hidden" aria-hidden="true" />
      </div>

      {error && <p className="hp-error">{error}</p>}

      <p className="hp-note">
        Opponent HP is kept in a private document only they can read.
      </p>
    </section>
  )
}
