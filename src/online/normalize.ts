import type {
  BoardEffects,
  BombMarker,
  BombKind,
  EventOffer,
  EventSummary,
  MatchSide,
  PublicMatch,
  ShieldMarker,
} from './types'
import { EVENT_CATALOGUE_BY_KIND, type EventKind } from '../game/events'

const MATCH_SIDES: ReadonlySet<string> = new Set(['white', 'black'])
const BOMB_KINDS: ReadonlySet<string> = new Set(['friendly', 'triple'])

function isSide(value: unknown): value is MatchSide {
  return typeof value === 'string' && MATCH_SIDES.has(value)
}

function isBombKind(value: unknown): value is BombKind {
  return typeof value === 'string' && BOMB_KINDS.has(value)
}

export function isEventKind(value: unknown): value is EventKind {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(EVENT_CATALOGUE_BY_KIND, value)
  )
}

function normalizeBombs(value: unknown): BombMarker[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return []
    }
    const bomb = entry as Partial<BombMarker>
    if (
      typeof bomb.square !== 'string' ||
      !isSide(bomb.side) ||
      !isBombKind(bomb.kind)
    ) {
      return []
    }
    return [
      {
        square: bomb.square,
        side: bomb.side,
        kind: bomb.kind,
        movesLeft: typeof bomb.movesLeft === 'number' ? bomb.movesLeft : null,
      },
    ]
  })
}

function normalizeShields(value: unknown): ShieldMarker[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return []
    }
    const shield = entry as Partial<ShieldMarker>
    if (typeof shield.square !== 'string' || !isSide(shield.side)) {
      return []
    }
    return [{ square: shield.square, side: shield.side }]
  })
}

function normalizeEffects(value: unknown): BoardEffects {
  if (typeof value !== 'object' || value === null) {
    return { bombs: [], shields: [], hijack: null }
  }
  const effects = value as Partial<BoardEffects>
  const hijackBy =
    effects.hijack && typeof effects.hijack.byUid === 'string'
      ? effects.hijack.byUid
      : null
  return {
    bombs: normalizeBombs(effects.bombs),
    shields: normalizeShields(effects.shields),
    hijack: hijackBy ? { byUid: hijackBy } : null,
  }
}

function normalizeOffer(value: unknown): EventOffer | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const offer = value as Partial<EventOffer>
  if (
    typeof offer.id !== 'string' ||
    !isEventKind(offer.kind) ||
    !isSide(offer.offeredTo) ||
    typeof offer.cost !== 'number' ||
    typeof offer.expiresAtMs !== 'number'
  ) {
    return null
  }
  const definition = EVENT_CATALOGUE_BY_KIND[offer.kind]
  return {
    id: offer.id,
    kind: offer.kind,
    offeredTo: offer.offeredTo,
    cost: definition.cost,
    requiresPiece: definition.pieceTarget !== null,
    createdAtMs:
      typeof offer.createdAtMs === 'number' ? offer.createdAtMs : 0,
    expiresAtMs: offer.expiresAtMs,
  }
}

function normalizeSummary(value: unknown): EventSummary | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const summary = value as Partial<EventSummary>
  if (
    typeof summary.id !== 'string' ||
    !isEventKind(summary.kind) ||
    (summary.outcome !== 'accepted' &&
      summary.outcome !== 'declined' &&
      summary.outcome !== 'expired')
  ) {
    return null
  }
  return {
    id: summary.id,
    kind: summary.kind,
    byUid: typeof summary.byUid === 'string' ? summary.byUid : null,
    outcome: summary.outcome,
    endedMatch: summary.endedMatch === true,
  }
}

/**
 * Firestore documents written before Phases 4–5 have no event or effect
 * fields. Default them here so live matches keep rendering.
 */
export function normalizePublicMatch(raw: unknown): PublicMatch {
  const data = (raw ?? {}) as Partial<PublicMatch>
  return {
    ...(data as PublicMatch),
    history: Array.isArray(data.history) ? data.history : [],
    event: normalizeOffer(data.event),
    effects: normalizeEffects(data.effects),
    lastEvent: normalizeSummary(data.lastEvent),
    lastEventPly:
      typeof data.lastEventPly === 'number' ? data.lastEventPly : null,
  }
}
