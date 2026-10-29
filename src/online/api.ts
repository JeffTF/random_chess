import type { Square } from 'chess.js'
import { httpsCallable } from 'firebase/functions'
import { auth, functions } from '../firebase/client'
import type { PromotionPiece } from '../game/types'
import type { MatchStatus } from './types'

const API_BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '')
  .trim()
  .replace(/\/+$/, '')

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
  blocked: 'shield' | null
  duplicate: boolean
}

export interface RespondToEventInput {
  matchId: string
  eventId: string
  accept: boolean
  square?: Square
}

export interface RespondToEventResult {
  version: number
  status: MatchStatus
  endReason: string | null
  outcome: 'accepted' | 'declined' | 'expired'
  hpLoss: number | null
  duplicate: boolean
}

export interface PrivateMatchState {
  hp: number
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
  if (error instanceof OnlineError) {
    return error
  }

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

interface ApiErrorBody {
  error?: { message?: unknown; reason?: unknown }
}

/** Netlify Function transport: the ID token is verified server-side. */
async function post<TOutput>(name: string, input: unknown): Promise<TOutput> {
  const user = auth.currentUser
  if (!user) {
    throw new OnlineError('Sign in before playing.')
  }
  const token = await user.getIdToken()

  let response: Response
  try {
    response = await fetch(`${API_BASE}/${name}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    })
  } catch {
    throw new OnlineError(
      'Cannot reach the game server. Check your connection and try again.',
    )
  }

  const payload = (await response.json().catch(() => null)) as
    | (TOutput & ApiErrorBody)
    | null

  if (!response.ok) {
    const message =
      typeof payload?.error?.message === 'string' &&
      payload.error.message.length > 0
        ? payload.error.message
        : 'The request could not be completed.'
    const reason =
      typeof payload?.error?.reason === 'string'
        ? payload.error.reason
        : undefined
    throw new OnlineError(message, reason)
  }

  return payload as TOutput
}

async function call<TInput, TOutput>(
  name: string,
  input: TInput,
): Promise<TOutput> {
  try {
    if (API_BASE) {
      return await post<TOutput>(name, input)
    }
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

export function respondToEvent(
  input: RespondToEventInput,
): Promise<RespondToEventResult> {
  return call('respondToEvent', input)
}

export function getMyPrivateMatchState(
  matchId: string,
): Promise<PrivateMatchState> {
  return call('getMyPrivateMatchState', { matchId })
}

export function newRequestId(): string {
  return crypto.randomUUID()
}
