export type EventKind =
  | 'shared-hp-loss'
  | 'protect-piece'
  | 'friendly-bomb'
  | 'triple-bomb'
  | 'hijack-next-move'
  | 'swap-sides'
  | 'swap-hp'
  | 'reverse-last-move'

export type EventPieceTarget = 'own' | 'opponent'

export interface EventDefinition {
  kind: EventKind
  name: string
  description: string
  cost: number
  /** Which side of the board the accepting player must pick a piece on. */
  pieceTarget: EventPieceTarget | null
}

/**
 * The catalogue is shared by the server (rules and costs) and the browser
 * (offer copy). The server always re-reads cost from here rather than
 * trusting the stored offer.
 */
export const EVENT_CATALOGUE: readonly EventDefinition[] = [
  {
    kind: 'shared-hp-loss',
    name: 'Shared HP Loss',
    description:
      'Both players lose 5–15 HP, rolled separately by the server. Neither roll is shown to the opponent.',
    cost: 50,
    pieceTarget: null,
  },
  {
    kind: 'protect-piece',
    name: 'Protect a Piece',
    description:
      'Choose one of your non-king pieces. The next capture against it is cancelled and the shield is consumed.',
    cost: 20,
    pieceTarget: 'own',
  },
  {
    kind: 'friendly-bomb',
    name: 'Friendly Bomb',
    description:
      'Choose one of your non-king pieces and attach a bomb. If your opponent captures it, they lose 10 HP. The bomb stays attached through transformations.',
    cost: 5,
    pieceTarget: 'own',
  },
  {
    kind: 'triple-bomb',
    name: 'Triple Bomb',
    description:
      'The server marks up to three of your opponent’s pieces. Moving one of them within their next two turns deals 10 HP damage to them.',
    cost: 5,
    pieceTarget: null,
  },
  {
    kind: 'hijack-next-move',
    name: 'Hijack the Next Move',
    description:
      'The next piece your opponent moves joins your side at its destination. King moves are unaffected but still use up the hijack.',
    cost: 5,
    pieceTarget: null,
  },
  {
    kind: 'swap-sides',
    name: 'Swap Sides',
    description:
      'Pay 50 HP, then exchange control of White and Black. Pieces and the current turn stay where they are.',
    cost: 50,
    pieceTarget: null,
  },
  {
    kind: 'swap-hp',
    name: 'Swap HP',
    description:
      'Pay 50 HP first, then exchange both players’ remaining HP.',
    cost: 50,
    pieceTarget: null,
  },
  {
    kind: 'reverse-last-move',
    name: 'Reverse the Last Move',
    description:
      'Undo the immediately preceding move and take your turn from there. Once per match; HP and already-resolved effects are not rolled back.',
    cost: 20,
    pieceTarget: null,
  },
]

export const EVENT_CATALOGUE_BY_KIND: Record<EventKind, EventDefinition> =
  Object.fromEntries(
    EVENT_CATALOGUE.map((definition) => [definition.kind, definition]),
  ) as Record<EventKind, EventDefinition>

export interface EventTuning {
  offerChance: number
  minGapPlies: number
  responseTimeoutMs: number
  sharedLoss: { min: number; max: number }
  tripleBomb: { maxTargets: number; damage: number; windowTurns: number }
  friendlyBomb: { damage: number }
}

export const EVENT_TUNING: EventTuning = {
  offerChance: 0.25,
  minGapPlies: 2,
  responseTimeoutMs: 15_000,
  sharedLoss: { min: 5, max: 15 },
  tripleBomb: { maxTargets: 3, damage: 10, windowTurns: 2 },
  friendlyBomb: { damage: 10 },
}

export function eventDefinition(kind: EventKind): EventDefinition {
  return EVENT_CATALOGUE_BY_KIND[kind]
}
