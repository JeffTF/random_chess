import {
  HttpsError,
  onCall,
  type CallableRequest,
} from 'firebase-functions/v2/https'
import { adminApp } from './admin'
import {
  ApiError,
  createMatchFor,
  getMyPrivateMatchStateFor,
  joinMatchFor,
  resignMatchFor,
  respondToEventFor,
  submitMoveFor,
  toApiError,
} from './api'

adminApp()

const REGION = process.env.CHAOS_FUNCTIONS_REGION ?? 'asia-southeast1'
const CALLABLE_OPTIONS = { region: REGION }

function requireUid(request: CallableRequest<unknown>): string {
  const uid = request.auth?.uid
  if (!uid) {
    throw new ApiError('unauthenticated', 'Sign in before playing.')
  }
  return uid
}

function toHttpsError(error: unknown): HttpsError {
  const apiError = toApiError(error)
  return new HttpsError(
    apiError.code,
    apiError.message,
    apiError.reason ? { reason: apiError.reason } : undefined,
  )
}

async function call<T>(
  request: CallableRequest<unknown>,
  run: (uid: string, data: unknown) => Promise<T>,
): Promise<T> {
  try {
    const uid = requireUid(request)
    return await run(uid, request.data)
  } catch (error) {
    throw toHttpsError(error)
  }
}

export const createMatch = onCall(CALLABLE_OPTIONS, (request) =>
  call(request, (uid) => createMatchFor(uid)),
)

export const joinMatch = onCall(CALLABLE_OPTIONS, (request) =>
  call(request, joinMatchFor),
)

export const submitMove = onCall(CALLABLE_OPTIONS, (request) =>
  call(request, submitMoveFor),
)

export const respondToEvent = onCall(CALLABLE_OPTIONS, (request) =>
  call(request, respondToEventFor),
)

export const resignMatch = onCall(CALLABLE_OPTIONS, (request) =>
  call(request, resignMatchFor),
)

export const getMyPrivateMatchState = onCall(CALLABLE_OPTIONS, (request) =>
  call(request, getMyPrivateMatchStateFor),
)
