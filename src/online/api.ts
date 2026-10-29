import type { Square } from 'chess.js'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase/client'
import type { PromotionPiece } from '../game/types'
import type { MatchStatus } from './types'

export interface CreateMatchResult {
  matchId: string
  roomCode: string
}

export interface JoinMatchResult {
  matchId: string
}

export interface SubmitMoveInput {
  matchId: string
  requestId: string
  from: Square
  to: Square
  promotion?: PromotionPiece
  expectedVersion: number
}

export interface SubmitMoveResult {
  version: number
  status: MatchStatus
  endReason: string | null
  duplicate: boolean
}

export class OnlineError extends Error {
  constructor(
    message: string,
    readonly reason?: string,
  ) {
    super(message)
    this.name = 'OnlineError'
  }
}

function toOnlineError(error: unknown): OnlineError {
  const candidate = error as {
    code?: unknown
    message?: unknown
    details?: unknown
  }

  const code = typeof candidate?.code === 'string' ? candidate.code : ''
  const details = candidate?.details as { reason?: unknown } | undefined
  const reason =
    typeof details?.reason === 'string' ? details.reason : undefined

  if (code === 'functions/unavailable' || code === 'functions/deadline-exceeded') {
    return new OnlineError(
      'Cannot reach the game server. Start the Firebase emulators and try again.',
      reason,
    )
  }

  const message =
    typeof candidate?.message === 'string' && candidate.message.length > 0
      ? candidate.message
      : 'The request could not be completed.'

  return new OnlineError(message, reason)
}

async function call<TInput, TOutput>(
  name: string,
  input: TInput,
): Promise<TOutput> {
  try {
    const callable = httpsCallable<TInput, TOutput>(functions, name)
    const result = await callable(input)
    return result.data
  } catch (error) {
    throw toOnlineError(error)
  }
}

export function createMatch(): Promise<CreateMatchResult> {
  return call('createMatch', {})
}

export function joinMatch(roomCode: string): Promise<JoinMatchResult> {
  return call('joinMatch', { roomCode })
}

export function submitMove(input: SubmitMoveInput): Promise<SubmitMoveResult> {
  return call('submitMove', input)
}

export function newRequestId(): string {
  return crypto.randomUUID()
}
