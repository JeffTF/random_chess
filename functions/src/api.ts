import {
  FieldValue,
  getFirestore,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore'
import { Chess } from 'chess.js'
import { PROMOTION_PIECES } from '../../src/game/config'
import type { PromotionPiece } from '../../src/game/types'
import { eventTuning } from './config'
import { maybeOfferEvent, resolveEvent } from './eventRules'
import { clampHp, normalizePrivate, STARTING_HP } from './hp'
import {
  assertSquare,
  emptyEffects,
  MatchRuleError,
  applyMove,
  normalizeMatch,
  sideOf,
  uidForSide,
  type MatchRuleReason,
} from './matchRules'
import { generateRoomCode, normalizeRoomCode } from './roomCodes'
import { secureRandom } from './random'
import type {
  EventDocument,
  EventOffer,
  HpByUid,
  MatchDocument,
  PrivateByUid,
  PrivateMatchDocument,
} from './types'

const START_FEN = new Chess().fen()
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export type ApiErrorCode =
  | 'unauthenticated'
  | 'invalid-argument'
  | 'permission-denied'
  | 'failed-precondition'
  | 'aborted'
  | 'not-found'
  | 'resource-exhausted'
  | 'internal'

export type ApiReason = MatchRuleReason | 'match-full'

/** Transport-neutral failure; callable and HTTP adapters map it to their own shape. */
export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly reason?: ApiReason,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const RULE_CODES: Record<MatchRuleReason, ApiErrorCode> = {
  'not-a-member': 'permission-denied',
  'wrong-turn': 'failed-precondition',
  'match-not-active': 'failed-precondition',
  'stale-version': 'aborted',
  'invalid-move': 'invalid-argument',
  'event-pending': 'failed-precondition',
  'event-not-pending': 'failed-precondition',
  'not-event-target': 'permission-denied',
  'cannot-afford': 'failed-precondition',
  'invalid-selection': 'invalid-argument',
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error
  }
  if (error instanceof MatchRuleError) {
    return new ApiError(RULE_CODES[error.reason], error.message, error.reason)
  }
  console.error('Unexpected match failure', error)
  return new ApiError('internal', 'The request could not be completed.')
}

export function asRecord(data: unknown): Record<string, unknown> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new ApiError('invalid-argument', 'Invalid request payload.')
  }
  return data as Record<string, unknown>
}

function requireString(value: unknown, field: string, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new ApiError('invalid-argument', `${field} is invalid.`)
  }
  return value
}

function requireVersion(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 1_000_000
  ) {
    throw new ApiError('invalid-argument', 'expectedVersion is invalid.')
  }
  return value
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ApiError('invalid-argument', `${field} is invalid.`)
  }
  return value
}

function optionalPromotion(value: unknown): PromotionPiece | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (
    typeof value !== 'string' ||
    !(PROMOTION_PIECES as readonly string[]).includes(value)
  ) {
    throw new ApiError('invalid-argument', 'promotion is invalid.')
  }
  return value as PromotionPiece
}

function squareOrThrow(value: unknown, field: string) {
  try {
    return assertSquare(value, field)
  } catch (error) {
    throw new ApiError(
      'invalid-argument',
      error instanceof Error ? error.message : `${field} is invalid.`,
    )
  }
}

function optionalSquare(value: unknown) {
  if (value === undefined || value === null) {
    return null
  }
  return squareOrThrow(value, 'square')
}

async function allocateRoomCode(db: Firestore): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateRoomCode()
    const existing = await db
      .collection('matches')
      .where('roomCode', '==', code)
      .limit(1)
      .get()
    if (existing.empty) {
      return code
    }
  }
  throw new ApiError(
    'resource-exhausted',
    'Could not allocate a room code. Please try again.',
  )
}

async function readPrivate(
  transaction: Transaction,
  matchRef: DocumentReference,
  uid: string | null,
): Promise<PrivateMatchDocument> {
  if (!uid) {
    return { hp: STARTING_HP }
  }
  const snapshot = await transaction.get(
    matchRef.collection('private').doc(uid),
  )
  return normalizePrivate(
    snapshot.exists
      ? (snapshot.data() as Partial<PrivateMatchDocument>)
      : undefined,
  )
}

async function readPrivateMap(
  transaction: Transaction,
  matchRef: DocumentReference,
  state: MatchDocument,
): Promise<PrivateByUid> {
  const [white, black] = await Promise.all([
    readPrivate(transaction, matchRef, state.playerWhiteUid),
    readPrivate(transaction, matchRef, state.playerBlackUid),
  ])
  const result: PrivateByUid = {}
  if (state.playerWhiteUid) {
    result[state.playerWhiteUid] = white
  }
  if (state.playerBlackUid) {
    result[state.playerBlackUid] = black
  }
  return result
}

function hpMapFrom(privateState: PrivateByUid): HpByUid {
  const hp: HpByUid = {}
  for (const [uid, value] of Object.entries(privateState)) {
    hp[uid] = value.hp
  }
  return hp
}

function publicFields(state: MatchDocument) {
  return {
    status: state.status,
    playerWhiteUid: state.playerWhiteUid,
    playerBlackUid: state.playerBlackUid,
    currentTurn: state.currentTurn,
    fen: state.fen,
    startFen: state.startFen,
    plyCount: state.plyCount,
    version: state.version,
    history: state.history,
    lastMove: state.lastMove,
    winnerUid: state.winnerUid,
    endReason: state.endReason,
    event: state.event,
    effects: state.effects,
    lastEvent: state.lastEvent,
    lastEventPly: state.lastEventPly,
  }
}

function writePrivates(
  transaction: Transaction,
  matchRef: DocumentReference,
  privateState: PrivateByUid,
) {
  for (const [uid, value] of Object.entries(privateState)) {
    transaction.set(matchRef.collection('private').doc(uid), {
      hp: clampHp(value.hp),
      ...(value.reverseUsed ? { reverseUsed: true } : {}),
    })
  }
}

function eventDocument(
  offer: EventOffer,
  offeredToUid: string | null,
): EventDocument {
  return {
    kind: offer.kind,
    offeredToUid: offeredToUid ?? '',
    cost: offer.cost,
    status: 'pending',
    createdAtMs: offer.createdAtMs,
    expiresAtMs: offer.expiresAtMs,
    resolvedAtMs: null,
  }
}

export async function createMatchFor(uid: string) {
  const db = getFirestore()
  const roomCode = await allocateRoomCode(db)
  const ref = db.collection('matches').doc()
  const batch = db.batch()

  batch.set(ref, {
    status: 'waiting',
    roomCode,
    playerWhiteUid: uid,
    playerBlackUid: null,
    currentTurn: 'white',
    fen: START_FEN,
    startFen: START_FEN,
    plyCount: 0,
    version: 0,
    history: [],
    lastMove: null,
    winnerUid: null,
    endReason: null,
    event: null,
    effects: emptyEffects(),
    lastEvent: null,
    lastEventPly: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  batch.set(ref.collection('private').doc(uid), {
    hp: STARTING_HP,
  })
  await batch.commit()

  return { matchId: ref.id, roomCode }
}

export async function joinMatchFor(uid: string, input: unknown) {
  const data = asRecord(input)

  let roomCode: string
  try {
    roomCode = normalizeRoomCode(data.roomCode)
  } catch (error) {
    throw new ApiError(
      'invalid-argument',
      error instanceof Error ? error.message : 'Invalid room code.',
    )
  }

  const db = getFirestore()
  const snapshot = await db
    .collection('matches')
    .where('roomCode', '==', roomCode)
    .limit(1)
    .get()

  const matchRef = snapshot.docs[0]?.ref
  if (!matchRef) {
    throw new ApiError('not-found', 'No match uses that room code.')
  }

  await db.runTransaction(async (transaction) => {
    const matchSnapshot = await transaction.get(matchRef)
    if (!matchSnapshot.exists) {
      throw new ApiError('not-found', 'No match uses that room code.')
    }

    const match = matchSnapshot.data() as MatchDocument
    if (match.playerWhiteUid === uid || match.playerBlackUid === uid) {
      return
    }
    if (match.status !== 'waiting' || match.playerBlackUid !== null) {
      throw new ApiError(
        'failed-precondition',
        'This match already has two players.',
        'match-full',
      )
    }

    transaction.update(matchRef, {
      playerBlackUid: uid,
      status: 'active',
      updatedAt: FieldValue.serverTimestamp(),
    })
    transaction.set(matchRef.collection('private').doc(uid), {
      hp: STARTING_HP,
    })
  })

  return { matchId: matchRef.id }
}

export async function submitMoveFor(uid: string, input: unknown) {
  const data = asRecord(input)

  const matchId = requireString(data.matchId, 'matchId', ID_PATTERN)
  const requestId = requireString(
    data.requestId,
    'requestId',
    /^[A-Za-z0-9_-]{8,64}$/,
  )
  const expectedVersion = requireVersion(data.expectedVersion)
  const from = squareOrThrow(data.from, 'from')
  const to = squareOrThrow(data.to, 'to')
  const promotion = optionalPromotion(data.promotion)

  const db = getFirestore()
  const matchRef = db.collection('matches').doc(matchId)
  const moveRef = matchRef.collection('moves').doc(requestId)
  const nowMs = Date.now()

  return db.runTransaction(async (transaction) => {
    const [matchSnapshot, moveSnapshot] = await Promise.all([
      transaction.get(matchRef),
      transaction.get(moveRef),
    ])

    if (!matchSnapshot.exists) {
      throw new ApiError('not-found', 'Match not found.')
    }

    const state = normalizeMatch(matchSnapshot.data()!)

    // Retries reuse the same requestId, so an existing move means this
    // request was already applied; report success without applying it twice.
    if (moveSnapshot.exists) {
      const stored = moveSnapshot.data() as { blocked?: string | null }
      return {
        version: state.version,
        status: state.status,
        endReason: state.endReason,
        blocked: stored.blocked ?? null,
        duplicate: true,
      }
    }

    let privateState = await readPrivateMap(transaction, matchRef, state)
    let current = state
    let expiredEvent: ReturnType<typeof resolveEvent> | null = null
    let expiredEventId: string | null = null

    if (current.status === 'event_pending') {
      if (!current.event) {
        throw new ApiError('failed-precondition', 'The match is paused.')
      }
      if (nowMs < current.event.expiresAtMs) {
        throw new ApiError(
          'failed-precondition',
          'Answer the pending event before moving.',
          'event-pending',
        )
      }
      if (expectedVersion !== current.version) {
        throw new ApiError(
          'aborted',
          'The board has already changed. Look at the latest position and try again.',
          'stale-version',
        )
      }
      expiredEventId = current.event.id
      try {
        expiredEvent = resolveEvent(
          current,
          hpMapFrom(privateState),
          privateState,
          {
            uid,
            eventId: expiredEventId,
            accept: false,
            nowMs,
          },
          secureRandom,
          eventTuning(),
        )
      } catch (error) {
        throw toApiError(error)
      }
      current = expiredEvent.next
      privateState = expiredEvent.private
    }

    let outcome
    try {
      outcome = applyMove(
        current,
        {
          playerUid: uid,
          // When an expired offer was settled in this same transaction the
          // caller could only have seen the pre-expiry version, so the
          // version check must use the freshly resolved state.
          expectedVersion: expiredEvent ? current.version : expectedVersion,
          from,
          to,
          promotion,
        },
        secureRandom,
        hpMapFrom(privateState),
      )
    } catch (error) {
      throw toApiError(error)
    }

    if (expiredEvent && expiredEventId) {
      transaction.set(
        matchRef.collection('events').doc(expiredEventId),
        expiredEvent.eventDoc,
        { merge: true },
      )
    }

    if (outcome.blocked) {
      transaction.set(moveRef, {
        requestId,
        playerUid: uid,
        blocked: outcome.blocked,
        version: outcome.next.version,
        createdAt: FieldValue.serverTimestamp(),
      })
      transaction.update(matchRef, {
        ...publicFields(outcome.next),
        updatedAt: FieldValue.serverTimestamp(),
      })
      return {
        version: outcome.next.version,
        status: outcome.next.status,
        endReason: outcome.next.endReason,
        blocked: outcome.blocked,
        duplicate: false,
      }
    }

    let next = outcome.next
    let offer: EventOffer | null = null
    if (next.status === 'active') {
      const offered = maybeOfferEvent(
        next,
        privateState,
        secureRandom,
        nowMs,
        eventTuning(),
      )
      if (offered) {
        next = offered.state
        offer = offered.offer
      }
    }

    const record = outcome.record!
    transaction.set(moveRef, {
      requestId,
      playerUid: uid,
      from,
      to,
      promotion: record.promotion,
      san: record.san,
      captured: record.captured,
      transformation: record.transformation,
      effects: record.effects ?? null,
      pieceBefore: outcome.pieceBefore,
      pieceAfter: outcome.pieceAfter,
      fen: record.fen,
      version: next.version,
      createdAt: FieldValue.serverTimestamp(),
    })
    transaction.update(matchRef, {
      ...publicFields(next),
      updatedAt: FieldValue.serverTimestamp(),
    })

    if (offer) {
      transaction.set(
        matchRef.collection('events').doc(offer.id),
        eventDocument(offer, uidForSide(next, offer.offeredTo)),
      )
    }

    for (const [privateUid, value] of Object.entries(privateState)) {
      transaction.set(matchRef.collection('private').doc(privateUid), {
        hp: clampHp(outcome.hp[privateUid] ?? value.hp),
        ...(value.reverseUsed ? { reverseUsed: true } : {}),
      })
    }

    return {
      version: next.version,
      status: next.status,
      endReason: next.endReason,
      blocked: null,
      duplicate: false,
    }
  })
}

export async function respondToEventFor(uid: string, input: unknown) {
  const data = asRecord(input)

  const matchId = requireString(data.matchId, 'matchId', ID_PATTERN)
  const eventId = requireString(data.eventId, 'eventId', ID_PATTERN)
  const accept = requireBoolean(data.accept, 'accept')
  const square = optionalSquare(data.square)
  const nowMs = Date.now()

  const db = getFirestore()
  const matchRef = db.collection('matches').doc(matchId)
  const eventRef = matchRef.collection('events').doc(eventId)

  return db.runTransaction(async (transaction) => {
    const [matchSnapshot, eventSnapshot] = await Promise.all([
      transaction.get(matchRef),
      transaction.get(eventRef),
    ])

    if (!matchSnapshot.exists) {
      throw new ApiError('not-found', 'Match not found.')
    }

    const state = normalizeMatch(matchSnapshot.data()!)
    if (!sideOf(state, uid)) {
      throw new ApiError(
        'permission-denied',
        'You are not a player in this match.',
        'not-a-member',
      )
    }

    if (!eventSnapshot.exists) {
      throw new ApiError(
        'failed-precondition',
        'That event is no longer active.',
        'event-not-pending',
      )
    }

    const eventDoc = eventSnapshot.data() as EventDocument
    if (eventDoc.status !== 'pending') {
      return {
        version: state.version,
        status: state.status,
        endReason: state.endReason,
        outcome: eventDoc.status,
        hpLoss: null,
        duplicate: true,
      }
    }

    if (
      state.status !== 'event_pending' ||
      !state.event ||
      state.event.id !== eventId
    ) {
      throw new ApiError(
        'failed-precondition',
        'That event is no longer active.',
        'event-not-pending',
      )
    }

    const privateState = await readPrivateMap(transaction, matchRef, state)

    let result
    try {
      result = resolveEvent(
        state,
        hpMapFrom(privateState),
        privateState,
        { uid, eventId, accept, square, nowMs },
        secureRandom,
        eventTuning(),
      )
    } catch (error) {
      throw toApiError(error)
    }

    transaction.update(matchRef, {
      ...publicFields(result.next),
      updatedAt: FieldValue.serverTimestamp(),
    })
    transaction.update(eventRef, result.eventDoc)
    writePrivates(transaction, matchRef, result.private)

    return {
      version: result.next.version,
      status: result.next.status,
      endReason: result.next.endReason,
      outcome: result.outcome,
      hpLoss: result.hpLoss,
      duplicate: false,
    }
  })
}

export async function getMyPrivateMatchStateFor(uid: string, input: unknown) {
  const data = asRecord(input)
  const matchId = requireString(data.matchId, 'matchId', ID_PATTERN)

  const db = getFirestore()
  const matchRef = db.collection('matches').doc(matchId)
  const matchSnapshot = await matchRef.get()
  if (!matchSnapshot.exists) {
    throw new ApiError('not-found', 'Match not found.')
  }

  const match = normalizeMatch(matchSnapshot.data()!)
  if (!sideOf(match, uid)) {
    throw new ApiError(
      'permission-denied',
      'You are not a player in this match.',
      'not-a-member',
    )
  }

  const privateSnapshot = await matchRef.collection('private').doc(uid).get()
  const privateState = normalizePrivate(
    privateSnapshot.exists
      ? (privateSnapshot.data() as Partial<PrivateMatchDocument>)
      : undefined,
  )

  // Only the caller's own HP ever leaves the server here.
  return { hp: privateState.hp }
}

export type ApiAction =
  | 'createMatch'
  | 'joinMatch'
  | 'submitMove'
  | 'respondToEvent'
  | 'getMyPrivateMatchState'

export function runAction(
  action: ApiAction,
  uid: string,
  data: unknown,
): Promise<unknown> {
  switch (action) {
    case 'createMatch':
      return createMatchFor(uid)
    case 'joinMatch':
      return joinMatchFor(uid, data)
    case 'submitMove':
      return submitMoveFor(uid, data)
    case 'respondToEvent':
      return respondToEventFor(uid, data)
    case 'getMyPrivateMatchState':
      return getMyPrivateMatchStateFor(uid, data)
  }
}
