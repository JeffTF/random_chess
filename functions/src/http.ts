import { adminApp } from './admin'
import { verifyFirebaseIdToken } from './idToken'
import {
  ApiError,
  runAction,
  toApiError,
  type ApiAction,
  type ApiErrorCode,
} from './api'

const STATUS: Record<ApiErrorCode, number> = {
  unauthenticated: 401,
  'invalid-argument': 400,
  'permission-denied': 403,
  'failed-precondition': 412,
  aborted: 409,
  'not-found': 404,
  'resource-exhausted': 429,
  internal: 500,
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text()
  if (text.trim() === '') {
    return {}
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new ApiError('invalid-argument', 'Invalid request payload.')
  }
}

const app = adminApp()
const projectId = app.options.projectId ?? process.env.GCLOUD_PROJECT ?? ''
if (projectId === '') {
  throw new Error('Cannot determine the Firebase project id for token checks.')
}
const emulator = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST)

async function uidFrom(request: Request): Promise<string> {
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer (.+)$/.exec(header)
  const token = match?.[1]
  if (!token) {
    throw new ApiError('unauthenticated', 'Sign in before playing.')
  }
  try {
    return await verifyFirebaseIdToken(token, { projectId, emulator })
  } catch {
    throw new ApiError(
      'unauthenticated',
      'Your session expired. Reload the page and try again.',
    )
  }
}

/** Netlify Functions v2 handler for one action; auth is verified per request. */
export function makeHandler(action: ApiAction) {
  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return json(405, {
        error: { code: 'method-not-allowed', message: 'Use POST.' },
      })
    }

    try {
      const uid = await uidFrom(request)
      const data = await readBody(request)
      const result = await runAction(action, uid, data)
      return json(200, result)
    } catch (error) {
      const apiError = toApiError(error)
      return json(STATUS[apiError.code], {
        error: {
          code: apiError.code,
          message: apiError.message,
          ...(apiError.reason ? { reason: apiError.reason } : {}),
        },
      })
    }
  }
}
