import { Chess, type Square } from 'chess.js'
import { ChaosChessGame } from '../../src/game/ChaosChessGame'
import {
  EVENT_CATALOGUE,
  EVENT_TUNING,
  eventDefinition,
  type EventKind,
  type EventTuning,
} from '../../src/game/events'
import { randomIndex } from '../../src/game/random'
import type { BoardSquare, RandomSource } from '../../src/game/types'
import { clampHp, hpEnding, hpPairFor, STARTING_HP } from './hp'
import {
  colorForSide,
  endFields,
  MatchRuleError,
  normalizeEffects,
  oppositeSide,
  sideForColor,
  sideOf,
  uidForSide,
} from './matchRules'
import type {
  EventDocument,
  EventOffer,
  EventSummary,
  HpByUid,
  MatchDocument,
  MatchSide,
  PrivateByUid,
} from './types'

export interface OfferResult {
  state: MatchDocument
  offer: EventOffer
}

function boardPieces(fen: string): BoardSquare[] {
  return new Chess(fen)
    .board()
    .flat()
    .filter((cell): cell is BoardSquare => cell !== null)
}

function privateFor(
  state: MatchDocument,
  privateInput: PrivateByUid,
): PrivateByUid {
  const result: PrivateByUid = {}
  for (const [uid, value] of Object.entries(privateInput)) {
    result[uid] = { ...value }
  }
  for (const uid of [state.playerWhiteUid, state.playerBlackUid]) {
    if (uid && !result[uid]) {
      result[uid] = { hp: STARTING_HP }
    }
  }
  return result
}

function syncPrivate(
  state: MatchDocument,
  hp: HpByUid,
  privateState: PrivateByUid,
): PrivateByUid {
  const result: PrivateByUid = {}
  for (const uid of [state.playerWhiteUid, state.playerBlackUid]) {
    if (!uid) {
      continue
    }
    const existing = privateState[uid]
    result[uid] = {
      hp: hp[uid] ?? existing?.hp ?? STARTING_HP,
      ...(existing?.reverseUsed ? { reverseUsed: true } : {}),
    }
  }
  return result
}

function hasReverseUsed(
  privateInput: PrivateByUid,
  uid: string,
): boolean {
  return privateInput[uid]?.reverseUsed === true
}

/**
 * "Reverse the Last Move" is only safe while no board marker exists and
 * the preceding move did not itself resolve an effect.
 */
export function reverseEligible(
  state: MatchDocument,
  uid: string,
  privateInput: PrivateByUid,
): boolean {
  if (state.status !== 'active' && state.status !== 'event_pending') {
    return false
  }
  if (state.history.length === 0) {
    return false
  }
  if (hasReverseUsed(privateInput, uid)) {
    return false
  }
  const effects = normalizeEffects(state.effects)
  if (
    effects.bombs.length > 0 ||
    effects.shields.length > 0 ||
    effects.hijack !== null
  ) {
    return false
  }
  const last = state.history[state.history.length - 1]!
  if (last.effects) {
    return false
  }
  const side = sideOf(state, uid)
  return side !== null && sideForColor(last.color) === side
}

export function eligibleEventKinds(
  state: MatchDocument,
  side: MatchSide,
  privateInput: PrivateByUid,
): EventKind[] {
  const board = boardPieces(state.fen)
  const own = board.filter(
    (piece) => colorForSide(side) === piece.color && piece.type !== 'k',
  )
  const enemy = board.filter(
    (piece) => colorForSide(side) !== piece.color && piece.type !== 'k',
  )
  const effects = normalizeEffects(state.effects)
  const shielded = new Set(effects.shields.map((marker) => marker.square))
  const bombed = new Set(effects.bombs.map((marker) => marker.square))
  const uid = uidForSide(state, side)

  return EVENT_CATALOGUE.filter((definition) => {
    switch (definition.kind) {
      case 'protect-piece':
        return own.some((piece) => !shielded.has(piece.square))
      case 'friendly-bomb':
        return own.some((piece) => !bombed.has(piece.square))
      case 'triple-bomb':
        return enemy.some((piece) => !bombed.has(piece.square))
      case 'hijack-next-move':
        return effects.hijack === null
      case 'reverse-last-move':
        return uid !== null && reverseEligible(state, uid, privateInput)
      default:
        return true
    }
  }).map((definition) => definition.kind)
}

/**
 * Called inside the same transaction as the move that triggered it. The
 * offer is made to the player who just moved, so the opponent's next move
 * is the natural moment for effects such as hijack and bombs.
 */
export function maybeOfferEvent(
  state: MatchDocument,
  privateInput: PrivateByUid,
  random: RandomSource,
  nowMs: number,
  tuning: EventTuning = EVENT_TUNING,
): OfferResult | null {
  if (state.status !== 'active' || state.event !== null) {
    return null
  }
  if (state.plyCount === 0 || state.history.length === 0) {
    return null
  }
  if (
    state.lastEventPly !== null &&
    state.plyCount - state.lastEventPly < tuning.minGapPlies
  ) {
    return null
  }
  if (random() >= tuning.offerChance) {
    return null
  }

  const last = state.history[state.history.length - 1]!
  const offeredTo = sideForColor(last.color)
  const kinds = eligibleEventKinds(state, offeredTo, privateInput)
  if (kinds.length === 0) {
    return null
  }

  const kind = kinds[randomIndex(random, kinds.length)]!
  const definition = eventDefinition(kind)
  const offer: EventOffer = {
    id: `event-${state.version + 1}`,
    kind,
    offeredTo,
    cost: definition.cost,
    requiresPiece: definition.pieceTarget !== null,
    createdAtMs: nowMs,
    expiresAtMs: nowMs + tuning.responseTimeoutMs,
  }

  return {
    state: {
      ...state,
      status: 'event_pending',
      event: offer,
      lastEventPly: state.plyCount,
      version: state.version + 1,
    },
    offer,
  }
}

export interface ResolveEventRequest {
  uid: string
  eventId: string
  accept: boolean
  square?: Square | null
  nowMs: number
}

export interface ResolvedEvent {
  next: MatchDocument
  hp: HpByUid
  private: PrivateByUid
  eventDoc: Pick<EventDocument, 'status' | 'resolvedAtMs'>
  outcome: 'accepted' | 'declined' | 'expired'
  /** Only the caller's own loss; the opponent's roll never leaves the server. */
  hpLoss: number | null
}

function rollDamage(random: RandomSource, min: number, max: number): number {
  return min + randomIndex(random, max - min + 1)
}

function takeRandom<T>(
  items: readonly T[],
  count: number,
  random: RandomSource,
): T[] {
  const pool = [...items]
  const picked: T[] = []
  while (picked.length < count && pool.length > 0) {
    const index = randomIndex(random, pool.length)
    picked.push(pool.splice(index, 1)[0]!)
  }
  return picked
}

function pieceForSquare(
  state: MatchDocument,
  uid: string,
  square: Square | null | undefined,
): BoardSquare {
  const side = sideOf(state, uid)
  if (!side) {
    throw new MatchRuleError(
      'not-a-member',
      'You are not a player in this match.',
    )
  }
  if (!square) {
    throw new MatchRuleError(
      'invalid-selection',
      'Choose one of your pieces for this event.',
    )
  }
  const piece = boardPieces(state.fen).find((cell) => cell.square === square)
  if (!piece || piece.color !== colorForSide(side) || piece.type === 'k') {
    throw new MatchRuleError(
      'invalid-selection',
      'That square does not hold one of your non-king pieces.',
    )
  }
  return piece
}

export function resolveEvent(
  state: MatchDocument,
  hpInput: HpByUid,
  privateInput: PrivateByUid,
  request: ResolveEventRequest,
  random: RandomSource,
  tuning: EventTuning = EVENT_TUNING,
): ResolvedEvent {
  const offer = state.event
  if (state.status !== 'event_pending' || !offer) {
    throw new MatchRuleError(
      'event-not-pending',
      'There is no event waiting for an answer.',
    )
  }
  if (offer.id !== request.eventId) {
    throw new MatchRuleError(
      'event-not-pending',
      'That event is no longer active.',
    )
  }

  const side = sideOf(state, request.uid)
  if (!side) {
    throw new MatchRuleError(
      'not-a-member',
      'You are not a player in this match.',
    )
  }

  const hp: HpByUid = { ...hpInput }
  const priv = privateFor(state, privateInput)
  const now = request.nowMs
  const offeredUid = uidForSide(state, offer.offeredTo)

  const settle = (outcome: 'declined' | 'expired'): ResolvedEvent => {
    const next: MatchDocument = {
      ...state,
      status: 'active',
      event: null,
      version: state.version + 1,
      lastEvent: {
        id: offer.id,
        kind: offer.kind,
        byUid: offeredUid,
        outcome,
        endedMatch: false,
      },
    }
    return {
      next,
      hp,
      private: syncPrivate(state, hp, priv),
      eventDoc: { status: outcome, resolvedAtMs: now },
      outcome,
      hpLoss: null,
    }
  }

  if (now >= offer.expiresAtMs) {
    return settle('expired')
  }
  if (side !== offer.offeredTo) {
    throw new MatchRuleError(
      'not-event-target',
      'This event was offered to your opponent.',
    )
  }
  if (!request.accept) {
    return settle('declined')
  }

  // The catalogue is authoritative; never trust a stored cost.
  const cost = eventDefinition(offer.kind).cost
  const currentHp = hp[request.uid] ?? STARTING_HP
  if (currentHp < cost) {
    throw new MatchRuleError(
      'cannot-afford',
      `You need ${cost} HP to accept this event.`,
    )
  }

  hp[request.uid] = clampHp(currentHp - cost)

  let nextState: MatchDocument = { ...state }
  let hpLoss: number | null = null

  // A cost that reaches 0 ends the match immediately; the effect does not
  // activate.
  if ((hp[request.uid] ?? 0) > 0) {
    switch (offer.kind) {
      case 'shared-hp-loss': {
        const whiteUid = state.playerWhiteUid
        const blackUid = state.playerBlackUid
        const whiteLoss = rollDamage(
          random,
          tuning.sharedLoss.min,
          tuning.sharedLoss.max,
        )
        const blackLoss = rollDamage(
          random,
          tuning.sharedLoss.min,
          tuning.sharedLoss.max,
        )
        if (whiteUid) {
          hp[whiteUid] = clampHp((hp[whiteUid] ?? STARTING_HP) - whiteLoss)
        }
        if (blackUid) {
          hp[blackUid] = clampHp((hp[blackUid] ?? STARTING_HP) - blackLoss)
        }
        hpLoss = side === 'white' ? whiteLoss : blackLoss
        break
      }
      case 'protect-piece': {
        const piece = pieceForSquare(state, request.uid, request.square)
        const effects = normalizeEffects(state.effects)
        if (effects.shields.some((marker) => marker.square === piece.square)) {
          throw new MatchRuleError(
            'invalid-selection',
            'That piece is already shielded.',
          )
        }
        nextState = {
          ...nextState,
          effects: {
            ...effects,
            shields: [...effects.shields, { square: piece.square, side }],
          },
        }
        break
      }
      case 'friendly-bomb': {
        const piece = pieceForSquare(state, request.uid, request.square)
        const effects = normalizeEffects(state.effects)
        if (effects.bombs.some((marker) => marker.square === piece.square)) {
          throw new MatchRuleError(
            'invalid-selection',
            'That piece already carries a bomb.',
          )
        }
        nextState = {
          ...nextState,
          effects: {
            ...effects,
            bombs: [
              ...effects.bombs,
              {
                square: piece.square,
                side,
                kind: 'friendly',
                movesLeft: null,
              },
            ],
          },
        }
        break
      }
      case 'triple-bomb': {
        const opponentSide = oppositeSide(side)
        const effects = normalizeEffects(state.effects)
        const bombed = new Set(effects.bombs.map((marker) => marker.square))
        const targets = boardPieces(state.fen).filter(
          (piece) =>
            piece.type !== 'k' &&
            piece.color === colorForSide(opponentSide) &&
            !bombed.has(piece.square),
        )
        if (targets.length === 0) {
          throw new MatchRuleError(
            'invalid-selection',
            'Your opponent has no eligible pieces to bomb.',
          )
        }
        const chosen = takeRandom(
          targets,
          Math.min(tuning.tripleBomb.maxTargets, targets.length),
          random,
        )
        nextState = {
          ...nextState,
          effects: {
            ...effects,
            bombs: [
              ...effects.bombs,
              ...chosen.map((piece) => ({
                square: piece.square,
                side: opponentSide,
                kind: 'triple' as const,
                movesLeft: tuning.tripleBomb.windowTurns,
              })),
            ],
          },
        }
        break
      }
      case 'hijack-next-move': {
        const effects = normalizeEffects(state.effects)
        if (effects.hijack) {
          throw new MatchRuleError(
            'invalid-selection',
            'A hijack is already active.',
          )
        }
        nextState = {
          ...nextState,
          effects: { ...effects, hijack: { byUid: request.uid } },
        }
        break
      }
      case 'swap-sides': {
        nextState = {
          ...nextState,
          playerWhiteUid: state.playerBlackUid,
          playerBlackUid: state.playerWhiteUid,
        }
        break
      }
      case 'swap-hp': {
        const opponentUid = uidForSide(state, oppositeSide(side))
        if (opponentUid) {
          const own = hp[request.uid] ?? STARTING_HP
          hp[request.uid] = hp[opponentUid] ?? STARTING_HP
          hp[opponentUid] = own
        }
        break
      }
      case 'reverse-last-move': {
        if (!reverseEligible(state, request.uid, priv)) {
          throw new MatchRuleError(
            'invalid-selection',
            'The last move cannot be reversed safely.',
          )
        }
        const last = state.history[state.history.length - 1]!
        const prior = state.history[state.history.length - 2]
        const restoredFen = prior?.fen ?? state.startFen
        const newHistory = state.history.slice(0, -1)
        const rebuilt = new ChaosChessGame({
          fen: restoredFen,
          startFen: state.startFen,
          history: newHistory,
          version: state.version,
        })
        nextState = {
          ...nextState,
          fen: restoredFen,
          history: newHistory,
          plyCount: newHistory.length,
          currentTurn: sideForColor(last.color),
          lastMove: prior ? { from: prior.from, to: prior.to } : null,
        }
        if (rebuilt.status.kind !== 'active') {
          nextState = { ...nextState, ...endFields(rebuilt.status, nextState) }
        }
        priv[request.uid] = { ...priv[request.uid]!, reverseUsed: true }
        break
      }
      default:
        break
    }
  }

  const hpEndingResult = hpEnding(
    hpPairFor(nextState, hp),
    nextState.playerWhiteUid,
    nextState.playerBlackUid,
  )
  const ending =
    hpEndingResult ??
    (nextState.status === 'finished'
      ? {
          status: 'finished' as const,
          winnerUid: nextState.winnerUid,
          endReason: nextState.endReason,
        }
      : { status: 'active' as const, winnerUid: null, endReason: null })

  const endedMatch = ending.status === 'finished'
  const summary: EventSummary = {
    id: offer.id,
    kind: offer.kind,
    byUid: request.uid,
    outcome: 'accepted',
    endedMatch,
  }

  const next: MatchDocument = {
    ...nextState,
    status: ending.status,
    winnerUid: ending.winnerUid,
    endReason: ending.endReason,
    event: null,
    lastEvent: summary,
    version: state.version + 1,
  }

  return {
    next,
    hp,
    private: syncPrivate(nextState, hp, priv),
    eventDoc: { status: 'accepted', resolvedAtMs: now },
    outcome: 'accepted',
    hpLoss,
  }
}
