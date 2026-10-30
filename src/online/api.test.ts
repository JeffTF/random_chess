import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubmitMoveInput } from './api'

const callableMock = vi.hoisted(() => vi.fn())
const authMock = vi.hoisted(() => ({
  currentUser: null as null | { getIdToken: () => Promise<string> },
}))

vi.mock('firebase/functions', () => ({ httpsCallable: () => callableMock }))
vi.mock('../firebase/client', () => ({ auth: authMock, functions: {} }))

const input: SubmitMoveInput = {
  matchId: 'match-1',
  requestId: 'request-1',
  from: 'e2',
  to: 'e4',
  expectedVersion: 0,
}

const connected = {
  data: {
    version: 1,
    status: 'active',
    endReason: null,
    blocked: null,
    duplicate: false,
  },
}

function droppedConnection() {
  return Object.assign(new Error('internal [0]'), { code: 'functions/internal' })
}

function wrongTurn() {
  return Object.assign(new Error('It is not your turn.'), {
    code: 'functions/failed-precondition',
    details: { reason: 'wrong-turn' },
  })
}

describe('submitMove retry policy', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    callableMock.mockReset()
    authMock.currentUser = null
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('retries a dropped connection with the same request id', async () => {
    callableMock
      .mockRejectedValueOnce(droppedConnection())
      .mockResolvedValueOnce(connected)

    const { submitMove } = await import('./api')
    const pending = submitMove(input)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(pending).resolves.toMatchObject({ version: 1 })

    expect(callableMock).toHaveBeenCalledTimes(2)
    const [first, second] = callableMock.mock.calls
    expect(first![0]).toEqual(input)
    expect(second![0]).toEqual(input)
  })

  it('never retries a permanent rejection', async () => {
    callableMock.mockRejectedValueOnce(wrongTurn())

    const { submitMove } = await import('./api')
    await expect(submitMove(input)).rejects.toMatchObject({
      reason: 'wrong-turn',
      message: 'It is not your turn.',
    })
    expect(callableMock).toHaveBeenCalledTimes(1)
  })

  it('gives up after two retries', async () => {
    callableMock.mockRejectedValue(droppedConnection())

    const { submitMove } = await import('./api')
    const rejection = expect(submitMove(input)).rejects.toMatchObject({
      reason: 'unavailable',
    })
    await vi.advanceTimersByTimeAsync(2000)
    await rejection
    expect(callableMock).toHaveBeenCalledTimes(3)
  })

  it('retries a 5xx HTTP response over the Netlify transport', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test')
    vi.resetModules()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ version: 2, status: 'active', endReason: null, blocked: null, duplicate: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    authMock.currentUser = { getIdToken: async () => 'token' }

    const { submitMove } = await import('./api')
    const pending = submitMove(input)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(pending).resolves.toMatchObject({ version: 2 })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [firstCall, secondCall] = fetchMock.mock.calls
    const firstBody = JSON.parse(firstCall![1].body as string)
    const secondBody = JSON.parse(secondCall![1].body as string)
    expect(firstBody.requestId).toBe(input.requestId)
    expect(secondBody.requestId).toBe(input.requestId)
  })
})
