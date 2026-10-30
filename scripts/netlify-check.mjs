// Exercises the Netlify HTTP adapter against the Firebase Emulator Suite.
// Start `npm run emulators` first, then run:
//   node scripts/netlify-check.mjs
// It bundles functions/src/http.ts, serves it on a local port, and drives the
// five actions with real anonymous ID tokens.
import assert from 'node:assert/strict'
import http from 'node:http'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deleteApp, initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROJECT_ID = 'random-chess-4a16d'
const ACTIONS = [
  'createMatch',
  'joinMatch',
  'submitMove',
  'respondToEvent',
  'resignMatch',
  'getMyPrivateMatchState',
]

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099'
process.env.GCLOUD_PROJECT ??= PROJECT_ID

const requireFunctions = createRequire(
  path.join(ROOT, 'functions', 'package.json'),
)
const { build } = requireFunctions('esbuild')

// The bundle must live under functions/ so the external firebase-admin
// import resolves from functions/node_modules.
const bundlePath = path.join(ROOT, 'functions', 'lib', 'netlify-check.cjs')
await build({
  entryPoints: [path.join(ROOT, 'functions', 'src', 'http.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['firebase-admin'],
  outfile: bundlePath,
})

const { makeHandler } = requireFunctions(bundlePath)
const handlers = Object.fromEntries(
  ACTIONS.map((action) => [action, makeHandler(action)]),
)

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const action = url.pathname.split('/').filter(Boolean).pop() ?? ''
    const handler = handlers[action]
    if (!handler) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { code: 'not-found' } }))
      return
    }
    const chunks = []
    for await (const chunk of req) {
      chunks.push(chunk)
    }
    const body = Buffer.concat(chunks)
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: body.length > 0 && req.method !== 'GET' ? body : undefined,
    })
    const response = await handler(request)
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch (error) {
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        error: { code: 'harness', message: String(error) },
      }),
    )
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()

function pass(message) {
  console.log(`PASS  ${message}`)
}

async function signIn(name) {
  const app = initializeApp(
    {
      apiKey: 'emulator-placeholder',
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
      appId: '1:1:web:1',
    },
    name,
  )
  const auth = getAuth(app)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', {
    disableWarnings: true,
  })
  const { user } = await signInAnonymously(auth)
  return { app, token: await user.getIdToken() }
}

async function api(token, action, body = {}, method = 'POST') {
  const response = await fetch(`http://127.0.0.1:${port}/${action}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  })
  const payload = await response.json().catch(() => null)
  return { status: response.status, body: payload }
}

const clients = []
try {
  const alice = await signIn('netlify-alice')
  const bob = await signIn('netlify-bob')
  const eve = await signIn('netlify-eve')
  clients.push(alice.app, bob.app, eve.app)

  const created = await api(alice.token, 'createMatch')
  assert.equal(created.status, 200, JSON.stringify(created.body))
  const { matchId, roomCode } = created.body
  assert.equal(typeof matchId, 'string')
  assert.match(roomCode, /^[A-Z0-9]{6}$/)
  pass('createMatch returns a match and room code')

  const joined = await api(bob.token, 'joinMatch', { roomCode })
  assert.equal(joined.status, 200, JSON.stringify(joined.body))
  assert.equal(joined.body.matchId, matchId)
  pass('joinMatch activates the room for the second player')

  const outsider = await api(eve.token, 'getMyPrivateMatchState', { matchId })
  assert.equal(outsider.status, 403)
  assert.equal(outsider.body.error.reason, 'not-a-member')
  pass('non-members are rejected with permission-denied')

  const anonymous = await api(null, 'getMyPrivateMatchState', { matchId })
  assert.equal(anonymous.status, 401)
  assert.equal(anonymous.body.error.code, 'unauthenticated')
  pass('missing bearer token is rejected')

  const getRequest = await api(alice.token, 'createMatch', {}, 'GET')
  assert.equal(getRequest.status, 405)
  pass('non-POST requests are rejected')

  const move = await api(alice.token, 'submitMove', {
    matchId,
    requestId: 'netlify-alice-0001',
    from: 'e2',
    to: 'e4',
    expectedVersion: 0,
  })
  assert.equal(move.status, 200, JSON.stringify(move.body))
  assert.ok(move.body.version >= 1)
  assert.ok(['active', 'event_pending'].includes(move.body.status))
  pass('submitMove applies a legal move through the HTTP adapter')

  const retried = await api(alice.token, 'submitMove', {
    matchId,
    requestId: 'netlify-alice-0001',
    from: 'e2',
    to: 'e4',
    expectedVersion: 0,
  })
  assert.equal(retried.status, 200)
  assert.equal(retried.body.duplicate, true)
  assert.equal(retried.body.version, move.body.version)
  pass('duplicate requestId is idempotent')

  const privateState = await api(alice.token, 'getMyPrivateMatchState', {
    matchId,
  })
  assert.equal(privateState.status, 200)
  assert.equal(typeof privateState.body.hp, 'number')
  assert.ok(privateState.body.hp <= 100)
  pass('private HP is returned to its owner only')

  const resigned = await api(bob.token, 'resignMatch', { matchId })
  assert.equal(resigned.status, 200, JSON.stringify(resigned.body))
  assert.equal(resigned.body.status, 'finished')
  assert.equal(resigned.body.endReason, 'resignation')
  pass('resignMatch forfeits the match')

  const secondResign = await api(alice.token, 'resignMatch', { matchId })
  assert.equal(secondResign.status, 412)
  assert.equal(secondResign.body.error.reason, 'match-not-active')
  pass('a finished match rejects further resignations')

  const strangerResign = await api(eve.token, 'resignMatch', { matchId })
  assert.equal(strangerResign.status, 403)
  assert.equal(strangerResign.body.error.reason, 'not-a-member')
  pass('non-members cannot resign')
} finally {
  server.close()
  for (const app of clients) {
    await deleteApp(app).catch(() => {})
  }
  await rm(bundlePath, { force: true })
}

console.log('\nNETLIFY API CHECK PASSED')
