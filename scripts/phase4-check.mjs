// End-to-end check of Phases 4–5 (chaos events and their board effects)
// against the Firebase Emulator Suite. Run after `npm run emulators` is up:
//   node scripts/phase4-check.mjs
//
// The script uses the Admin SDK only to seed deterministic positions and
// offers; every rule decision still goes through the callable functions.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { deleteApp, initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
} from 'firebase/firestore'
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from 'firebase/functions'

const PROJECT_ID = 'random-chess-4a16d'
const REGION = 'asia-southeast1'
const CONFIG = {
  apiKey: 'emulator-placeholder',
  authDomain: `${PROJECT_ID}.firebaseapp.com`,
  projectId: PROJECT_ID,
  appId: '1:1:web:1',
}

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'

const requireFromFunctions = createRequire(
  new URL('../functions/package.json', import.meta.url),
)
const { initializeApp: initializeAdminApp } = requireFromFunctions(
  'firebase-admin/app',
)
const { getFirestore: getAdminFirestore } = requireFromFunctions(
  'firebase-admin/firestore',
)

function makeClient(name) {
  const app = initializeApp(CONFIG, name)
  const auth = getAuth(app)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', {
    disableWarnings: true,
  })
  const db = getFirestore(app)
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  const functions = getFunctions(app, REGION)
  connectFunctionsEmulator(functions, '127.0.0.1', 5001)
  return { app, auth, db, functions }
}

async function call(client, name, data) {
  const result = await httpsCallable(client.functions, name)(data)
  return result.data
}

async function expectFailure(action, code, reason) {
  try {
    await action()
  } catch (error) {
    assert.equal(error.code, code, `expected ${code}, got ${error.code}`)
    if (reason !== undefined) {
      assert.equal(
        error.details?.reason,
        reason,
        `expected reason ${reason}, got ${error.details?.reason}`,
      )
    }
    return error
  }
  throw new Error(`Expected ${code} but the call succeeded.`)
}

function findKey(value, key, path = '') {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const found = findKey(entry, key, `${path}[${index}]`)
      if (found) {
        return found
      }
    }
    return null
  }
  if (value && typeof value === 'object') {
    for (const [entryKey, entryValue] of Object.entries(value)) {
      const entryPath = `${path}/${entryKey}`
      if (entryKey === key) {
        return entryPath
      }
      const found = findKey(entryValue, key, entryPath)
      if (found) {
        return found
      }
    }
  }
  return null
}

function emptyEffects() {
  return { bombs: [], shields: [], hijack: null }
}

function pass(label) {
  console.log(`PASS  ${label}`)
}

const clients = []
let adminApp = null
try {
  adminApp = initializeAdminApp({ projectId: PROJECT_ID }, 'phase4-admin')
  const adminDb = getAdminFirestore(adminApp)

  const alice = makeClient('alice-phase4')
  const bob = makeClient('bob-phase4')
  const eve = makeClient('eve-phase4')
  clients.push(alice, bob, eve)

  const aliceUid = (await signInAnonymously(alice.auth)).user.uid
  const bobUid = (await signInAnonymously(bob.auth)).user.uid
  await signInAnonymously(eve.auth)

  async function matchDoc(matchId) {
    const snapshot = await adminDb.doc(`matches/${matchId}`).get()
    assert.equal(snapshot.exists, true, 'match document must exist')
    return snapshot.data()
  }

  async function writeMatch(matchId, fields) {
    await adminDb.doc(`matches/${matchId}`).set(fields, { merge: true })
  }

  async function writeEvent(matchId, eventId, fields) {
    await adminDb.doc(`matches/${matchId}/events/${eventId}`).set(fields)
  }

  function clientForUid(uid) {
    return uid === aliceUid ? alice : bob
  }

  // Real moves may trigger a random offer (25% by default). Decline it so
  // the deterministic checks below always start from a live board.
  async function settleOffer(matchId) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const match = await matchDoc(matchId)
      if (match.status !== 'event_pending' || !match.event) {
        return match
      }
      const targetUid =
        match.event.offeredTo === 'white'
          ? match.playerWhiteUid
          : match.playerBlackUid
      const caller =
        match.event.expiresAtMs <= Date.now()
          ? alice
          : clientForUid(targetUid)
      await call(caller, 'respondToEvent', {
        matchId,
        eventId: match.event.id,
        accept: false,
      })
    }
    return matchDoc(matchId)
  }

  const { matchId, roomCode } = await call(alice, 'createMatch', {})
  await call(bob, 'joinMatch', { roomCode })
  pass(`room ${roomCode} created and joined`)

  const created = await matchDoc(matchId)
  assert.equal(created.event, null)
  assert.deepEqual(created.effects, emptyEffects())
  assert.equal(created.lastEvent, null)
  assert.equal(created.lastEventPly, null)
  pass('new matches start with no offer and empty board effects')

  await call(alice, 'submitMove', {
    matchId,
    requestId: 'phase4-alice-e4-0001',
    from: 'e2',
    to: 'e4',
    expectedVersion: 0,
  })
  let match = await settleOffer(matchId)
  assert.equal(match.history.length, 1)
  assert.equal(match.status, 'active')
  pass('real move applied; any random offer was settled')

  await call(bob, 'submitMove', {
    matchId,
    requestId: 'phase4-bob-e5-0001',
    from: 'e7',
    to: 'e5',
    expectedVersion: match.version,
  })
  match = await settleOffer(matchId)
  assert.equal(match.history.length, 2)
  assert.equal(match.currentTurn, 'white')
  pass('reply applied through the same server path')

  // --- Friendly bomb: the capturer takes the damage ---------------------
  const bombFen = '4k3/8/8/4p3/3P4/8/8/4K3 b - - 0 1'
  const bombVersion = match.version + 1
  await writeMatch(matchId, {
    status: 'active',
    event: null,
    currentTurn: 'black',
    fen: bombFen,
    plyCount: 0,
    history: [],
    lastMove: null,
    winnerUid: null,
    endReason: null,
    version: bombVersion,
    effects: {
      bombs: [
        { square: 'd4', side: 'white', kind: 'friendly', movesLeft: null },
      ],
      shields: [],
      hijack: null,
    },
    lastEvent: null,
    lastEventPly: null,
  })

  const bombMove = await call(bob, 'submitMove', {
    matchId,
    requestId: 'phase4-bomb-capture-0001',
    from: 'e5',
    to: 'd4',
    expectedVersion: bombVersion,
  })
  assert.equal(bombMove.blocked, null)

  let afterBomb = await settleOffer(matchId)
  assert.ok(afterBomb.version >= bombVersion + 1)
  assert.equal(afterBomb.history.length, 1)
  assert.equal(afterBomb.history[0].effects.bombDamage, 10)
  assert.deepEqual(afterBomb.effects.bombs, [])
  assert.equal(findKey(afterBomb, 'hp'), null)
  assert.deepEqual(await call(bob, 'getMyPrivateMatchState', { matchId }), {
    hp: 90,
  })
  assert.deepEqual(await call(alice, 'getMyPrivateMatchState', { matchId }), {
    hp: 100,
  })
  pass('friendly bomb damages the capturer privately and leaves public state HP-free')

  afterBomb = await settleOffer(matchId)

  // --- Shield: cancels the capture and is consumed ----------------------
  const shieldVersion = afterBomb.version + 1
  await writeMatch(matchId, {
    status: 'active',
    event: null,
    currentTurn: 'black',
    fen: bombFen,
    plyCount: 0,
    history: [],
    lastMove: null,
    version: shieldVersion,
    effects: {
      bombs: [],
      shields: [{ square: 'd4', side: 'white' }],
      hijack: null,
    },
  })

  const shielded = await call(bob, 'submitMove', {
    matchId,
    requestId: 'phase4-shield-capture-0001',
    from: 'e5',
    to: 'd4',
    expectedVersion: shieldVersion,
  })
  assert.equal(shielded.blocked, 'shield')

  const afterShield = await matchDoc(matchId)
  assert.equal(afterShield.version, shieldVersion + 1)
  assert.equal(afterShield.history.length, 0)
  assert.deepEqual(afterShield.effects.shields, [])
  assert.equal(afterShield.fen, bombFen)
  assert.deepEqual(await call(bob, 'getMyPrivateMatchState', { matchId }), {
    hp: 90,
  })
  pass('shield cancels the capture, is spent, and the move is not recorded')

  // --- Offer, validation, acceptance, and privacy ----------------------
  match = await matchDoc(matchId)
  const eventVersion = match.version + 1
  const eventId = `phase4-protect-${eventVersion}`
  const offerNow = Date.now()
  const protectFen = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1'
  await writeMatch(matchId, {
    status: 'event_pending',
    event: {
      id: eventId,
      kind: 'protect-piece',
      offeredTo: 'white',
      cost: 20,
      requiresPiece: true,
      createdAtMs: offerNow,
      expiresAtMs: offerNow + 60_000,
    },
    currentTurn: 'white',
    fen: protectFen,
    plyCount: 0,
    history: [],
    lastMove: null,
    version: eventVersion,
    effects: emptyEffects(),
  })
  await writeEvent(matchId, eventId, {
    kind: 'protect-piece',
    offeredToUid: aliceUid,
    cost: 20,
    status: 'pending',
    createdAtMs: offerNow,
    expiresAtMs: offerNow + 60_000,
    resolvedAtMs: null,
  })
  pass('pending offer seeded for White with an event record')

  await expectFailure(
    () => getDoc(doc(eve.db, 'matches', matchId, 'events', eventId)),
    'permission-denied',
  )
  assert.equal(
    (await getDoc(doc(bob.db, 'matches', matchId, 'events', eventId))).exists(),
    true,
  )
  pass('event records are readable by players but not by non-members')

  await expectFailure(
    () =>
      call(eve, 'respondToEvent', {
        matchId,
        eventId,
        accept: true,
        square: 'e2',
      }),
    'functions/permission-denied',
    'not-a-member',
  )
  pass('non-member cannot answer events')

  await expectFailure(
    () => call(bob, 'respondToEvent', { matchId, eventId, accept: true }),
    'functions/permission-denied',
    'not-event-target',
  )
  pass('opponent cannot answer an event offered to the other player')

  await expectFailure(
    () =>
      call(bob, 'submitMove', {
        matchId,
        requestId: 'phase4-blocked-e5d4-0001',
        from: 'e5',
        to: 'd4',
        expectedVersion: eventVersion,
      }),
    'functions/failed-precondition',
    'event-pending',
  )
  await expectFailure(
    () =>
      call(alice, 'submitMove', {
        matchId,
        requestId: 'phase4-blocked-e2e3-0001',
        from: 'e2',
        to: 'e3',
        expectedVersion: eventVersion,
      }),
    'functions/failed-precondition',
    'event-pending',
  )
  pass('moves are frozen for both players while an offer is pending')

  await expectFailure(
    () =>
      call(alice, 'respondToEvent', {
        matchId,
        eventId,
        accept: true,
        square: 'e8',
      }),
    'functions/invalid-argument',
    'invalid-selection',
  )
  pass('server rejects a selected piece that is not the target’s own')

  const accepted = await call(alice, 'respondToEvent', {
    matchId,
    eventId,
    accept: true,
    square: 'e2',
  })
  assert.equal(accepted.outcome, 'accepted')
  assert.equal(accepted.hpLoss, null)

  const afterAccept = await matchDoc(matchId)
  assert.equal(afterAccept.status, 'active')
  assert.equal(afterAccept.event, null)
  assert.equal(afterAccept.version, eventVersion + 1)
  assert.deepEqual(afterAccept.effects.shields, [
    { square: 'e2', side: 'white' },
  ])
  assert.equal(afterAccept.lastEvent.kind, 'protect-piece')
  assert.equal(afterAccept.lastEvent.outcome, 'accepted')
  assert.equal(afterAccept.lastEvent.byUid, aliceUid)
  assert.equal(findKey(afterAccept, 'hp'), null)
  assert.deepEqual(await call(alice, 'getMyPrivateMatchState', { matchId }), {
    hp: 80,
  })
  pass('accepted event pays its catalogue cost and publishes only the shield')

  const eventRecord = (
    await getDoc(doc(bob.db, 'matches', matchId, 'events', eventId))
  ).data()
  assert.equal(eventRecord.status, 'accepted')
  assert.equal(findKey(eventRecord, 'hp'), null)
  pass('event record is updated and contains no HP')

  const repeated = await call(alice, 'respondToEvent', {
    matchId,
    eventId,
    accept: true,
    square: 'e2',
  })
  assert.equal(repeated.duplicate, true)
  assert.deepEqual(await call(alice, 'getMyPrivateMatchState', { matchId }), {
    hp: 80,
  })
  pass('repeating an answer does not charge HP twice')

  // --- Expiry: the non-target may settle once the clock passes ----------
  match = await matchDoc(matchId)
  const expiredVersion = match.version + 1
  const expiredId = `phase4-expired-${expiredVersion}`
  const expiredAt = Date.now() - 2_000
  await writeMatch(matchId, {
    status: 'event_pending',
    event: {
      id: expiredId,
      kind: 'swap-sides',
      offeredTo: 'white',
      cost: 50,
      requiresPiece: false,
      createdAtMs: expiredAt - 60_000,
      expiresAtMs: expiredAt,
    },
    currentTurn: 'white',
    fen: protectFen,
    plyCount: 0,
    history: [],
    lastMove: null,
    version: expiredVersion,
    effects: emptyEffects(),
  })
  await writeEvent(matchId, expiredId, {
    kind: 'swap-sides',
    offeredToUid: aliceUid,
    cost: 50,
    status: 'pending',
    createdAtMs: expiredAt - 60_000,
    expiresAtMs: expiredAt,
    resolvedAtMs: null,
  })

  const expired = await call(bob, 'respondToEvent', {
    matchId,
    eventId: expiredId,
    accept: false,
  })
  assert.equal(expired.outcome, 'expired')

  const afterExpiry = await matchDoc(matchId)
  assert.equal(afterExpiry.status, 'active')
  assert.equal(afterExpiry.event, null)
  assert.equal(afterExpiry.lastEvent.outcome, 'expired')
  assert.equal(afterExpiry.playerWhiteUid, aliceUid)
  assert.equal(afterExpiry.playerBlackUid, bobUid)
  assert.deepEqual(await call(alice, 'getMyPrivateMatchState', { matchId }), {
    hp: 80,
  })
  pass('expired offers resume the match for free without side effects')

  console.log('\nPHASE 4–5 EMULATOR CHECK PASSED')
} finally {
  await Promise.all(clients.map((client) => deleteApp(client.app)))
  if (adminApp) {
    await deleteApp(adminApp)
  }
}
