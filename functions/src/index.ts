import { initializeApp } from 'firebase-admin/app'
import {
  FieldValue,
  getFirestore,
  type Firestore,
} from 'firebase-admin/firestore'
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'
import { Chess } from 'chess.js'
import { PROMOTION_PIECES } from '../../src/game/config'
import type { PromotionPiece } from '../../src/game/types'
import {
  assertSquare,
  MatchRuleError,
  applyMove,
  type MatchRuleReason,
} from './matchRules'
import { generateRoomCode, normalizeRoomCode } from './roomCodes'
import { secureRandom } from './random'
import type { MatchDocument } from './types'

initializeApp()

const REGION = process.env.CHAOS_FUNCTIONS_REGION ?? 'asia-southeast1'
const START_FEN = new Chess().fen()
const CALLABLE_OPTIONS = { region: REGION }

function requireUid(request: CallableRequest<unknown>): string {
  const uid = request.auth?.uid
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in before playing.')
  }
  return uid
}

function asRecord(data: unknown): Record<string, unknown> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new HttpsError('invalid-argument', 'Invalid request payload.')
  }
  return data as Record<string, unknown>
}

function requireString(
  value: unknown,
  field: string,
  pattern: RegExp,
): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new HttpsError('invalid-argument', `${field} is invalid.`)
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
    throw new HttpsError('invalid-argument', 'expectedVersion is invalid.')
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
    throw new HttpsError('invalid-argument', 'promotion is invalid.')
  }
  return value as PromotionPiece
}

function squareOrThrow(value: unknown, field: string) {
  try {
    return assertSquare(value, field)
  } catch (error) {
    throw new HttpsError(
      'invalid-argument',
      error instanceof Error ? error.message : `${field} is invalid.`,
    )
  }
}

const HTTPS_CODES: Record<
  MatchRuleReason,
  'permission-denied' | 'failed-precondition' | 'aborted' | 'invalid-argument'
> = {
  'not-a-member': 'permission-denied',
  'wrong-turn': 'failed-precondition',
  'match-not-active': 'failed-precondition',
  'stale-version': 'aborted',
  'invalid-move': 'invalid-argument',
}

function toHttpsError(error: unknown): HttpsError {
  if (error instanceof HttpsError) {
    return error
  }
  if (error instanceof MatchRuleError) {
    return new HttpsError(
      HTTPS_CODES[error.reason],
      error.message,
      { reason: error.reason },
    )
  }
  console.error('Unexpected match failure', error)
  return new HttpsError('internal', 'The request could not be completed.')
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
  throw new HttpsError(
    'resource-exhausted',
    'Could not allocate a room code. Please try again.',
  )
}

export const createMatch = onCall(CALLABLE_OPTIONS, async (request) => {
  const uid = requireUid(request)
  const db = getFirestore()
  const roomCode = await allocateRoomCode(db)
  const ref = db.collection('matches').doc()

  await ref.create({
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
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return { matchId: ref.id, roomCode }
})

export const joinMatch = onCall(CALLABLE_OPTIONS, async (request) => {
  const uid = requireUid(request)
  const data = asRecord(request.data)

  let roomCode: string
  try {
    roomCode = normalizeRoomCode(data.roomCode)
  } catch (error) {
    throw new HttpsError(
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
    throw new HttpsError('not-found', 'No match uses that room code.')
  }

  await db.runTransaction(async (transaction) => {
    const matchSnapshot = await transaction.get(matchRef)
    if (!matchSnapshot.exists) {
      throw new HttpsError('not-found', 'No match uses that room code.')
    }

    const match = matchSnapshot.data() as MatchDocument
    if (
      match.playerWhiteUid === uid ||
      match.playerBlackUid === uid
    ) {
      return
    }
    if (match.status !== 'waiting' || match.playerBlackUid !== null) {
      throw new HttpsError(
        'failed-precondition',
        'This match already has two players.',
        { reason: 'match-full' },
      )
    }

    transaction.update(matchRef, {
      playerBlackUid: uid,
      status: 'active',
      updatedAt: FieldValue.serverTimestamp(),
    })
  })

  return { matchId: matchRef.id }
})

export const submitMove = onCall(CALLABLE_OPTIONS, async (request) => {
  const uid = requireUid(request)
  const data = asRecord(request.data)

  const matchId = requireString(data.matchId, 'matchId', /^[A-Za-z0-9_-]{1,128}$/)
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

  return db.runTransaction(async (transaction) => {
    const [matchSnapshot, moveSnapshot] = await Promise.all([
      transaction.get(matchRef),
      transaction.get(moveRef),
    ])

    if (!matchSnapshot.exists) {
      throw new HttpsError('not-found', 'Match not found.')
    }

    const state = matchSnapshot.data() as MatchDocument

    // Retries reuse the same requestId, so an existing move means this
    // request was already applied; report success without applying it twice.
    if (moveSnapshot.exists) {
      return {
        version: state.version,
        status: state.status,
        endReason: state.endReason,
        duplicate: true,
      }
    }

    let outcome
    try {
      outcome = applyMove(
        state,
        { playerUid: uid, expectedVersion, from, to, promotion },
        secureRandom,
      )
    } catch (error) {
      throw toHttpsError(error)
    }

    const next = outcome.next
    transaction.set(moveRef, {
      requestId,
      playerUid: uid,
      from,
      to,
      promotion: outcome.record.promotion,
      san: outcome.record.san,
      captured: outcome.record.captured,
      transformation: outcome.record.transformation,
      pieceBefore: outcome.pieceBefore,
      pieceAfter: outcome.pieceAfter,
      fen: next.fen,
      version: next.version,
      createdAt: FieldValue.serverTimestamp(),
    })
    transaction.update(matchRef, {
      status: next.status,
      winnerUid: next.winnerUid,
      endReason: next.endReason,
      currentTurn: next.currentTurn,
      fen: next.fen,
      plyCount: next.plyCount,
      version: next.version,
      history: next.history,
      lastMove: next.lastMove,
      updatedAt: FieldValue.serverTimestamp(),
    })

    return {
      version: next.version,
      status: next.status,
      endReason: next.endReason,
      duplicate: false,
    }
  })
})
