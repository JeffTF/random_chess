import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import { ChaosChessGame } from '../../src/game/ChaosChessGame'
import {
  EVENT_TUNING,
  eventDefinition,
  type EventKind,
} from '../../src/game/events'
import type { MoveRecord, RandomSource } from '../../src/game/types'
import {
  eligibleEventKinds,
  maybeOfferEvent,
  resolveEvent,
  type ResolveEventRequest,
} from './eventRules'
import { MatchRuleError } from './matchRules'
import type {
  EventOffer,
  HpByUid,
  MatchDocument,
  PrivateByUid,
} from './types'

const START_FEN = new Chess().fen()
const WHITE = 'uid-white'
const BLACK = 'uid-black'
const NOW = 1_000_000

function sequenceRandom(values: number[]): RandomSource {
  let index = 0
  return () => values[index++] ?? 0.999
}

function moveRecord(ply: number, color: 'w' | 'b'): MoveRecord {
  return {
    ply,
    color,
    san: 'e4',
    from: 'e2',
    to: 'e4',
    captured: null,
    promotion: null,
    transformation: null,
    fen: START_FEN,
  }
}

function activeMatch(overrides: Partial<MatchDocument> = {}): MatchDocument {
  return {
    status: 'active',
    roomCode: 'ABC234',
    playerWhiteUid: WHITE,
    playerBlackUid: BLACK,
    currentTurn: 'white',
    fen: START_FEN,
    startFen: START_FEN,
    plyCount: 2,
    version: 10,
    history: [moveRecord(1, 'w'), moveRecord(2, 'b')],
    lastMove: null,
    winnerUid: null,
    endReason: null,
    event: null,
    effects: { bombs: [], shields: [], hijack: null },
    lastEvent: null,
    lastEventPly: null,
    ...overrides,
  }
}

function withOffer(
  state: MatchDocument,
  kind: EventKind,
  overrides: Partial<EventOffer> = {},
): MatchDocument {
  const definition = eventDefinition(kind)
  const offer: EventOffer = {
    id: 'event-20',
    kind,
    offeredTo: 'white',
    cost: definition.cost,
    requiresPiece: definition.pieceTarget !== null,
    createdAtMs: NOW,
    expiresAtMs: NOW + EVENT_TUNING.responseTimeoutMs,
    ...overrides,
  }
  return {
    ...state,
    status: 'event_pending',
    event: offer,
    version: 20,
  }
}

function privateState(
  hp: Partial<HpByUid> = {},
  overrides: Partial<Record<string, Partial<PrivateByUid[string]>>> = {},
): PrivateByUid {
  return {
    [WHITE]: {
      hp: hp[WHITE] ?? 100,
      ...overrides[WHITE],
    },
    [BLACK]: {
      hp: hp[BLACK] ?? 100,
      ...overrides[BLACK],
    },
  }
}

function respond(
  uid: string,
  accept: boolean,
  overrides: Partial<ResolveEventRequest> = {},
): ResolveEventRequest {
  return {
    uid,
    eventId: 'event-20',
    accept,
    nowMs: NOW + 1_000,
    ...overrides,
  }
}

function reasonOf(action: () => unknown): string {
  try {
    action()
  } catch (error) {
    if (error instanceof MatchRuleError) {
      return error.reason
    }
    throw error
  }
  throw new Error('Expected a MatchRuleError to be thrown.')
}

describe('event scheduling', () => {
  it('offers at most one event at a time and only after the gap', () => {
    const state = activeMatch({ version: 10, plyCount: 4 })
    const always = () => 0
    const tuning = { ...EVENT_TUNING, offerChance: 1 }

    const first = maybeOfferEvent(state, privateState(), always, NOW, tuning)
    expect(first).not.toBeNull()
    expect(first!.offer.id).toBe('event-11')
    expect(first!.state.status).toBe('event_pending')
    expect(first!.state.version).toBe(11)
    expect(first!.state.lastEventPly).toBe(4)
    expect(first!.offer.offeredTo).toBe('black')

    expect(
      maybeOfferEvent(
        { ...first!.state, event: first!.offer },
        privateState(),
        always,
        NOW,
        tuning,
      ),
    ).toBeNull()

    const tooSoon = { ...state, plyCount: 5, lastEventPly: 4 }
    expect(
      maybeOfferEvent(tooSoon, privateState(), always, NOW, tuning),
    ).toBeNull()
  })

  it('respects the probability roll and finished matches', () => {
    const state = activeMatch({ plyCount: 4 })
    const tuning = { ...EVENT_TUNING, offerChance: 0.25 }

    expect(
      maybeOfferEvent(state, privateState(), () => 0.5, NOW, tuning),
    ).toBeNull()
    expect(
      maybeOfferEvent(
        { ...state, status: 'finished' },
        privateState(),
        () => 0,
        NOW,
        tuning,
      ),
    ).toBeNull()
  })

  it('lists eligible kinds and excludes unsafe reversals', () => {
    const state = activeMatch({
      effects: {
        bombs: [
          { square: 'e2', side: 'white', kind: 'friendly', movesLeft: null },
        ],
        shields: [],
        hijack: null,
      },
    })

    const kinds = eligibleEventKinds(state, 'white', privateState())
    expect(kinds).toContain('shared-hp-loss')
    expect(kinds).toContain('protect-piece')
    expect(kinds).toContain('triple-bomb')
    expect(kinds).not.toContain('reverse-last-move')

    const noHistory = activeMatch({ history: [], plyCount: 0 })
    expect(eligibleEventKinds(noHistory, 'white', privateState())).not.toContain(
      'reverse-last-move',
    )
  })
})

describe('event resolution', () => {
  it('declines for free and expires without a cost', () => {
    const state = withOffer(activeMatch(), 'protect-piece')
    const priv = privateState()

    const declined = resolveEvent(
      state,
      { [WHITE]: 100, [BLACK]: 100 },
      priv,
      respond(WHITE, false),
      sequenceRandom([]),
    )
    expect(declined.outcome).toBe('declined')
    expect(declined.hp[WHITE]).toBe(100)
    expect(declined.next.status).toBe('active')
    expect(declined.next.event).toBeNull()
    expect(declined.next.version).toBe(21)
    expect(declined.next.lastEvent?.outcome).toBe('declined')

    const expired = resolveEvent(
      state,
      { [WHITE]: 100, [BLACK]: 100 },
      priv,
      respond(WHITE, true, {
        nowMs: state.event!.expiresAtMs,
      }),
      sequenceRandom([]),
    )
    expect(expired.outcome).toBe('expired')
    expect(expired.hp[WHITE]).toBe(100)
    expect(expired.next.status).toBe('active')
    expect(expired.next.lastEvent?.outcome).toBe('expired')
  })

  it('rejects the opponent’s answer before the timeout', () => {
    const state = withOffer(activeMatch(), 'protect-piece')
    expect(
      reasonOf(() =>
        resolveEvent(
          state,
          { [WHITE]: 100, [BLACK]: 100 },
          privateState(),
          respond(BLACK, true, { square: 'b8' }),
          sequenceRandom([]),
        ),
      ),
    ).toBe('not-event-target')
  })

  it('charges the catalogue cost even when the stored offer is tampered', () => {
    const state = withOffer(activeMatch(), 'protect-piece', { cost: 0 })
    const result = resolveEvent(
      state,
      { [WHITE]: 100, [BLACK]: 100 },
      privateState(),
      respond(WHITE, true, { square: 'b1' }),
      sequenceRandom([]),
    )

    expect(result.outcome).toBe('accepted')
    expect(result.hp[WHITE]).toBe(80)
    expect(result.next.effects.shields).toEqual([
      { square: 'b1', side: 'white' },
    ])
    expect(result.private[WHITE]!.hp).toBe(80)
  })

  it('rejects selections that are not the player’s own non-king pieces', () => {
    const state = withOffer(activeMatch(), 'protect-piece')

    expect(
      reasonOf(() =>
        resolveEvent(
          state,
          { [WHITE]: 100, [BLACK]: 100 },
          privateState(),
          respond(WHITE, true, { square: 'e1' }),
          sequenceRandom([]),
        ),
      ),
    ).toBe('invalid-selection')

    expect(
      reasonOf(() =>
        resolveEvent(
          state,
          { [WHITE]: 100, [BLACK]: 100 },
          privateState(),
          respond(WHITE, true, { square: 'b8' }),
          sequenceRandom([]),
        ),
      ),
    ).toBe('invalid-selection')
  })

  it('rejects unaffordable events and ends the match when a cost reaches zero', () => {
    const state = withOffer(activeMatch(), 'protect-piece')

    expect(
      reasonOf(() =>
        resolveEvent(
          state,
          { [WHITE]: 10, [BLACK]: 100 },
          privateState({ [WHITE]: 10 }),
          respond(WHITE, true, { square: 'b1' }),
          sequenceRandom([]),
        ),
      ),
    ).toBe('cannot-afford')

    const broke = resolveEvent(
      state,
      { [WHITE]: 20, [BLACK]: 100 },
      privateState({ [WHITE]: 20 }),
      respond(WHITE, true, { square: 'b1' }),
      sequenceRandom([]),
    )
    expect(broke.hp[WHITE]).toBe(0)
    expect(broke.next.status).toBe('finished')
    expect(broke.next.endReason).toBe('hp-depleted')
    expect(broke.next.winnerUid).toBe(BLACK)
    expect(broke.next.effects.shields).toEqual([])
    expect(broke.next.lastEvent?.endedMatch).toBe(true)
  })

  it('rolls shared HP loss for both players and reports only the caller’s', () => {
    const state = withOffer(activeMatch(), 'shared-hp-loss')
    const result = resolveEvent(
      state,
      { [WHITE]: 100, [BLACK]: 100 },
      privateState(),
      respond(WHITE, true),
      sequenceRandom([0.5, 0.5]),
    )

    expect(result.hpLoss).toBe(10)
    expect(result.hp[WHITE]).toBe(40)
    expect(result.hp[BLACK]).toBe(90)
    expect(result.private[WHITE]!.hp).toBe(40)
    expect(result.private[BLACK]!.hp).toBe(90)
    expect(result.next.status).toBe('active')
  })

  it('declares a draw when shared HP loss empties both players', () => {
    const state = withOffer(activeMatch(), 'shared-hp-loss')
    const result = resolveEvent(
      state,
      { [WHITE]: 65, [BLACK]: 10 },
      privateState({ [WHITE]: 65, [BLACK]: 10 }),
      respond(WHITE, true),
      sequenceRandom([0.99, 0.99]),
    )

    expect(result.hp[WHITE]).toBe(0)
    expect(result.hp[BLACK]).toBe(0)
    expect(result.next.status).toBe('finished')
    expect(result.next.endReason).toBe('hp-depleted')
    expect(result.next.winnerUid).toBeNull()
  })

  it('places a friendly bomb on the chosen piece', () => {
    const state = withOffer(activeMatch(), 'friendly-bomb')
    const result = resolveEvent(
      state,
      { [WHITE]: 100, [BLACK]: 100 },
      privateState(),
      respond(WHITE, true, { square: 'b1' }),
      sequenceRandom([]),
    )

    expect(result.hp[WHITE]).toBe(95)
    expect(result.next.effects.bombs).toEqual([
      { square: 'b1', side: 'white', kind: 'friendly', movesLeft: null },
    ])
  })

  it('marks up to three of the opponent’s pieces with triple bombs', () => {
    const state = withOffer(activeMatch(), 'triple-bomb')
    const result = resolveEvent(
      state,
      { [WHITE]: 100, [BLACK]: 100 },
      privateState(),
      respond(WHITE, true),
      sequenceRandom([0, 0, 0]),
    )

    expect(result.hp[WHITE]).toBe(95)
    expect(result.next.effects.bombs).toEqual([
      { square: 'a8', side: 'black', kind: 'triple', movesLeft: 2 },
      { square: 'b8', side: 'black', kind: 'triple', movesLeft: 2 },
      { square: 'c8', side: 'black', kind: 'triple', movesLeft: 2 },
    ])
  })

  it('sets a pending hijack', () => {
    const state = withOffer(activeMatch(), 'hijack-next-move')
    const result = resolveEvent(
      state,
      { [WHITE]: 100, [BLACK]: 100 },
      privateState(),
      respond(WHITE, true),
      sequenceRandom([]),
    )

    expect(result.hp[WHITE]).toBe(95)
    expect(result.next.effects.hijack).toEqual({ byUid: WHITE })
  })

  it('swaps side control after paying', () => {
    const state = withOffer(activeMatch(), 'swap-sides')
    const result = resolveEvent(
      state,
      { [WHITE]: 100, [BLACK]: 100 },
      privateState(),
      respond(WHITE, true),
      sequenceRandom([]),
    )

    expect(result.hp[WHITE]).toBe(50)
    expect(result.next.playerWhiteUid).toBe(BLACK)
    expect(result.next.playerBlackUid).toBe(WHITE)
    expect(result.next.currentTurn).toBe('white')
    expect(result.next.fen).toBe(state.fen)
  })

  it('does not swap sides when the cost empties the payer', () => {
    const state = withOffer(activeMatch(), 'swap-sides')
    const result = resolveEvent(
      state,
      { [WHITE]: 50, [BLACK]: 100 },
      privateState({ [WHITE]: 50 }),
      respond(WHITE, true),
      sequenceRandom([]),
    )

    expect(result.hp[WHITE]).toBe(0)
    expect(result.next.status).toBe('finished')
    expect(result.next.winnerUid).toBe(BLACK)
    expect(result.next.playerWhiteUid).toBe(WHITE)
    expect(result.next.playerBlackUid).toBe(BLACK)
  })

  it('pays the HP cost before swapping HP values', () => {
    const state = withOffer(activeMatch(), 'swap-hp')
    const result = resolveEvent(
      state,
      { [WHITE]: 100, [BLACK]: 30 },
      privateState({ [WHITE]: 100, [BLACK]: 30 }),
      respond(WHITE, true),
      sequenceRandom([]),
    )

    expect(result.hp[WHITE]).toBe(30)
    expect(result.hp[BLACK]).toBe(50)
    expect(result.next.status).toBe('active')
  })

  it('reverses the last move once, returning the turn to the mover', () => {
    const game = new ChaosChessGame({ random: () => 0 })
    game.move('e2', 'e4')
    const state = withOffer(
      activeMatch({
        fen: game.fen,
        history: [...game.history],
        plyCount: 1,
        currentTurn: 'black',
        version: 10,
      }),
      'reverse-last-move',
      { offeredTo: 'white' },
    )

    const result = resolveEvent(
      state,
      { [WHITE]: 100, [BLACK]: 100 },
      privateState(),
      respond(WHITE, true),
      sequenceRandom([]),
    )

    expect(result.hp[WHITE]).toBe(80)
    expect(result.next.fen).toBe(START_FEN)
    expect(result.next.history).toEqual([])
    expect(result.next.plyCount).toBe(0)
    expect(result.next.currentTurn).toBe('white')
    expect(result.next.lastMove).toBeNull()
    expect(result.private[WHITE]!.reverseUsed).toBe(true)

    const again = withOffer(activeMatch({ history: [] }) , 'reverse-last-move')
    expect(
      reasonOf(() =>
        resolveEvent(
          again,
          { [WHITE]: 80, [BLACK]: 100 },
          privateState({ [WHITE]: 80 }, { [WHITE]: { reverseUsed: true } }),
          respond(WHITE, true),
          sequenceRandom([]),
        ),
      ),
    ).toBe('invalid-selection')
  })

  it('refuses to reverse while board markers exist', () => {
    const sf = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1'
    const game = new ChaosChessGame({ fen: sf, random: () => 0 })
    game.move('e2', 'e3')
    const state = withOffer(
      activeMatch({
        fen: game.fen,
        startFen: sf,
        history: [...game.history],
        plyCount: 1,
        currentTurn: 'black',
        effects: {
          bombs: [
            { square: 'e3', side: 'white', kind: 'friendly', movesLeft: null },
          ],
          shields: [],
          hijack: null,
        },
      }),
      'reverse-last-move',
      { offeredTo: 'white' },
    )

    expect(
      reasonOf(() =>
        resolveEvent(
          state,
          { [WHITE]: 100, [BLACK]: 100 },
          privateState(),
          respond(WHITE, true),
          sequenceRandom([]),
        ),
      ),
    ).toBe('invalid-selection')
  })
})
