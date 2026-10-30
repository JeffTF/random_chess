// Measures the live move path end to end: HTTP request, authoritative commit,
// and realtime delivery to both players. Run with:
//   node scripts/latency-check.mjs --moves=20
// It plays a real anonymous match against the deployed API in .env.local's
// project and prints per-move timings plus p50/p95/p99. Both clients run in
// this process, so their monotonic clocks are comparable. It never prints
// tokens, HP, or private documents.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { deleteApp, initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import { doc, getFirestore, onSnapshot } from 'firebase/firestore'
import { Chess } from 'chess.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function arg(name, fallback) {
  const prefix = `--${name}=`
  const hit = process.argv.find((value) => value.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : fallback
}

function readEnvLocal() {
  const text = readFileSync(path.join(ROOT, '.env.local'), 'utf8')
  const env = {}
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (match) {
      env[match[1]] = match[2].replace(/^"(.*)"$/, '$1')
    }
  }
  return env
}

const env = readEnvLocal()
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
}
const base = arg('base', 'https://rngchess.netlify.app')
const maxMoves = Number(arg('moves', '16'))
const gapMs = Number(arg('gap', '0'))
const idleMs = Number(arg('idle', '0'))
const sleepAfter = Number(arg('sleepAfter', '0'))
const sleepMs = Number(arg('sleepMs', '0'))
const probeCount = Number(arg('probes', '5'))
const prewarm = arg('prewarm', '1') !== '0'
const label = arg('label', 'live')

for (const [key, value] of Object.entries(config)) {
  if (!value) {
    throw new Error(`Missing ${key} in .env.local`)
  }
}

function percentile(values, p) {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, index)]
}

function summary(name, values) {
  if (values.length === 0) {
    console.log(`${name.padEnd(26)} no samples`)
    return
  }
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length
  console.log(
    `${name.padEnd(26)} n=${String(values.length).padStart(3)}  ` +
      `p50=${percentile(values, 50).toFixed(0)}ms  ` +
      `p95=${percentile(values, 95).toFixed(0)}ms  ` +
      `p99=${percentile(values, 99).toFixed(0)}ms  ` +
      `max=${Math.max(...values).toFixed(0)}ms  avg=${avg.toFixed(0)}ms`,
  )
}

async function makeClient(name) {
  const app = initializeApp(config, `${label}-${name}-${Date.now()}`)
  const auth = getAuth(app)
  const { user } = await signInAnonymously(auth)
  return {
    app,
    auth,
    uid: user.uid,
    db: getFirestore(app),
    token: await user.getIdToken(),
    latest: null,
  }
}

async function api(client, action, body = {}) {
  const started = performance.now()
  const response = await fetch(`${base}/api/${action}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${client.token}`,
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)
  return { ms: performance.now() - started, status: response.status, body: payload }
}

function waitFor(predicate, timeoutMs, what) {
  return new Promise((resolve, reject) => {
    const started = performance.now()
    const timer = setInterval(() => {
      const value = predicate()
      if (value) {
        clearInterval(timer)
        resolve(value)
      } else if (performance.now() - started > timeoutMs) {
        clearInterval(timer)
        reject(new Error(`Timed out waiting for ${what}.`))
      }
    }, 5)
  })
}

function legalMove(fen) {
  const chess = new Chess(fen)
  const moves = chess.moves({ verbose: true })
  if (moves.length === 0) {
    throw new Error('No legal moves in the authoritative position.')
  }
  return moves[0]
}

const alice = await makeClient('alice')
const bob = await makeClient('bob')
let matchId = null
const unsubscribers = []
const samples = []
const probes = []
const apiTimes = []
const warmCalls = []

try {
  const created = await api(alice, 'createMatch')
  if (created.status !== 200) {
    throw new Error(`createMatch failed: ${created.status} ${JSON.stringify(created.body)}`)
  }
  matchId = created.body.matchId
  const joined = await api(bob, 'joinMatch', { roomCode: created.body.roomCode })
  if (joined.status !== 200) {
    throw new Error(`joinMatch failed: ${joined.status} ${JSON.stringify(joined.body)}`)
  }

  for (const client of [alice, bob]) {
    unsubscribers.push(
      onSnapshot(doc(client.db, 'matches', matchId), (snapshot) => {
        client.latest = {
          at: performance.now(),
          data: snapshot.data(),
        }
      }),
    )
  }

  await waitFor(() => alice.latest && bob.latest, 15000, 'initial snapshots')

  // Mirrors the client's waiting-room prewarm so the measured moves do not
  // include the submitMove cold start.
  if (prewarm) {
    const warm = await api(alice, 'submitMove', { matchId, warm: true })
    if (warm.status !== 200) {
      throw new Error(`prewarm failed: ${warm.status} ${JSON.stringify(warm.body)}`)
    }
    warmCalls.push(warm.ms)
    console.log(`prewarm submitMove: ${warm.ms.toFixed(0)}ms`)
  }

  // Warm-path probes: a single-document read that still pays auth, function,
  // and Firestore RTTs, without the move transaction.
  for (let i = 0; i < probeCount; i += 1) {
    const probe = await api(alice, 'getMyPrivateMatchState', { matchId })
    if (probe.status !== 200) {
      throw new Error(`probe failed: ${probe.status} ${JSON.stringify(probe.body)}`)
    }
    probes.push(probe.ms)
    console.log(`probe ${i + 1}: ${probe.ms.toFixed(0)}ms`)
  }

  if (idleMs > 0) {
    console.log(`idling ${idleMs}ms before the first measured move...`)
    await new Promise((resolve) => setTimeout(resolve, idleMs))
  }

  console.log(`\nplaying ${maxMoves} measured moves against ${base}`)

  for (let i = 0; i < maxMoves; i += 1) {
    let state = alice.latest.data
    if (!state || state.status !== 'active') {
      if (state && state.status === 'event_pending') {
        const offeredSide = state.event.offeredTo
        const client = offeredSide === 'white' ? alice : bob
        const answer = await api(client, 'respondToEvent', {
          matchId,
          eventId: state.event.id,
          accept: false,
        })
        if (answer.status !== 200) {
          throw new Error(`decline failed: ${answer.status}`)
        }
        await waitFor(
          () => alice.latest.data.version > state.version,
          15000,
          'event resolution',
        )
        i -= 1
        continue
      }
      console.log(`match stopped: status=${state?.status} reason=${state?.endReason}`)
      break
    }

    const moverSide = state.currentTurn
    const mover = moverSide === 'white' ? alice : bob
    const other = moverSide === 'white' ? bob : alice
    const expectedVersion = state.version
    const move = legalMove(state.fen)
    const requestId = crypto.randomUUID()
    const sendAt = performance.now()

    const response = await api(mover, 'submitMove', {
      matchId,
      requestId,
      from: move.from,
      to: move.to,
      promotion: move.promotion,
      expectedVersion,
    })
    const apiAt = performance.now()

    if (response.status !== 200) {
      throw new Error(`submitMove failed: ${response.status} ${JSON.stringify(response.body)}`)
    }

    const own = await waitFor(
      () => mover.latest && mover.latest.data.version >= expectedVersion + 1 && mover.latest.at > sendAt && mover.latest,
      10000,
      `mover snapshot v${expectedVersion + 1}`,
    )
    const otherSeen = await waitFor(
      () => other.latest && other.latest.data.version >= expectedVersion + 1 && other.latest.at > sendAt && other.latest,
      10000,
      `opponent snapshot v${expectedVersion + 1}`,
    )

    const sample = {
      index: i + 1,
      version: own.data.version,
      apiMs: response.ms,
      apiObservedMs: apiAt - sendAt,
      ownMs: own.at - sendAt,
      oppMs: otherSeen.at - sendAt,
      status: own.data.status,
      endReason: own.data.endReason ?? null,
    }
    samples.push(sample)
    apiTimes.push(response.ms)
    console.log(
      `move ${String(sample.index).padStart(2)} v${sample.version} ` +
        `api=${sample.apiMs.toFixed(0)}ms own=${sample.ownMs.toFixed(0)}ms ` +
        `opponent=${sample.oppMs.toFixed(0)}ms status=${sample.status}`,
    )

    if (gapMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, gapMs))
    }
    if (sleepAfter > 0 && sample.index === sleepAfter && sleepMs > 0) {
      console.log(`sleeping ${sleepMs}ms after move ${sample.index}...`)
      await new Promise((resolve) => setTimeout(resolve, sleepMs))
    }
  }
} finally {
  for (const unsubscribe of unsubscribers) {
    unsubscribe()
  }
  await deleteApp(alice.app).catch(() => {})
  await deleteApp(bob.app).catch(() => {})
}

console.log(`\n== ${label} baseline ==`)
summary('prewarm call', warmCalls)
summary('probe request (warm)', probes)
summary('submitMove request', apiTimes)
summary('mover board update', samples.map((sample) => sample.ownMs))
summary('opponent board update', samples.map((sample) => sample.oppMs))
console.log(`samples=${samples.length} rejects=0 (script aborts on rejection)`)
