// End-to-end check of Phase 2 against the Firebase Emulator Suite.
// Run after `npm run emulators` is up:
//   node scripts/phase2-check.mjs
import assert from 'node:assert/strict'
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

function pass(label) {
  console.log(`PASS  ${label}`)
}

// A move may trigger a random event offer (Phase 4). Decline it through
// the offered player so version assertions below stay deterministic.
async function settleOffers(matchId, alice, bob) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const match = (await getDoc(doc(alice.db, 'matches', matchId))).data()
    const offer = match.event
    if (match.status !== 'event_pending' || !offer) {
      return match
    }
    const target = offer.offeredTo === 'white' ? alice : bob
    await call(target, 'respondToEvent', {
      matchId,
      eventId: offer.id,
      accept: false,
    })
  }
  return (await getDoc(doc(alice.db, 'matches', matchId))).data()
}

const clients = []
try {
  const alice = makeClient('alice')
  const bob = makeClient('bob')
  const eve = makeClient('eve')
  clients.push(alice, bob, eve)

  const aliceUid = (await signInAnonymously(alice.auth)).user.uid
  const bobUid = (await signInAnonymously(bob.auth)).user.uid
  await signInAnonymously(eve.auth)
  pass('three anonymous players signed in')

  const { matchId, roomCode } = await call(alice, 'createMatch', {})
  assert.match(roomCode, /^[A-HJ-NP-Z2-9]{6}$/)
  pass(`createMatch returned room ${roomCode}`)

  const created = (await getDoc(doc(alice.db, 'matches', matchId))).data()
  assert.equal(created.status, 'waiting')
  assert.equal(created.playerWhiteUid, aliceUid)
  assert.equal(created.playerBlackUid, null)
  assert.equal(created.version, 0)
  pass('creator reads own waiting match')

  const joined = await call(bob, 'joinMatch', { roomCode })
  assert.equal(joined.matchId, matchId)
  const active = (await getDoc(doc(bob.db, 'matches', matchId))).data()
  assert.equal(active.status, 'active')
  assert.equal(active.playerBlackUid, bobUid)
  pass('joinMatch assigns Black and activates the match')

  const rejoined = await call(bob, 'joinMatch', { roomCode })
  assert.equal(rejoined.matchId, matchId)
  pass('rejoining with the same account is idempotent')

  await expectFailure(
    () => getDoc(doc(eve.db, 'matches', matchId)),
    'permission-denied',
  )
  pass('non-member cannot read the match document')

  await expectFailure(
    () =>
      call(bob, 'submitMove', {
        matchId,
        requestId: 'bob-first-move-0001',
        from: 'e7',
        to: 'e5',
        expectedVersion: 0,
      }),
    'functions/failed-precondition',
    'wrong-turn',
  )
  pass('server rejects a move made out of turn')

  await expectFailure(
    () =>
      call(alice, 'submitMove', {
        matchId,
        requestId: 'alice-e2e5-0001',
        from: 'e2',
        to: 'e5',
        expectedVersion: 0,
      }),
    'functions/invalid-argument',
    'invalid-move',
  )
  pass('server rejects an illegal move')

  const firstRequest = 'alice-e2e4-0001'
  const first = await call(alice, 'submitMove', {
    matchId,
    requestId: firstRequest,
    from: 'e2',
    to: 'e4',
    expectedVersion: 0,
  })
  assert.ok(first.version >= 1)
  assert.ok(['active', 'event_pending'].includes(first.status))
  pass('white move applied on the server')

  const afterFirst = await settleOffers(matchId, alice, bob)
  assert.equal(afterFirst.currentTurn, 'black')
  assert.ok(afterFirst.version >= 1)
  assert.equal(afterFirst.plyCount, 1)
  assert.equal(afterFirst.history.length, 1)
  const [record] = afterFirst.history
  assert.equal(record.san, 'e4')
  assert.equal(record.transformation.from, 'p')
  assert.notEqual(record.transformation.to, 'p')
  assert.ok(['n', 'b', 'r', 'q'].includes(record.transformation.to))
  assert.deepEqual(afterFirst.lastMove, { from: 'e2', to: 'e4' })
  const firstVersion = afterFirst.version
  pass('opponent sees the same transformed board state')

  const replay = await call(alice, 'submitMove', {
    matchId,
    requestId: firstRequest,
    from: 'e2',
    to: 'e4',
    expectedVersion: 0,
  })
  assert.equal(replay.duplicate, true)
  assert.equal(replay.version, firstVersion)
  const afterReplay = await settleOffers(matchId, alice, bob)
  assert.equal(afterReplay.version, firstVersion)
  assert.equal(afterReplay.history.length, 1)
  pass('duplicate requestId does not apply the move twice')

  await expectFailure(
    () =>
      call(alice, 'submitMove', {
        matchId,
        requestId: firstRequest,
        from: 'd2',
        to: 'd4',
        expectedVersion: afterReplay.version,
      }),
    'functions/invalid-argument',
    'request-id-conflict',
  )
  pass('requestId reuse with different move content is rejected')

  const beforeWarm = (
    await getDoc(doc(bob.db, 'matches', matchId))
  ).data()
  const warmed = await call(bob, 'submitMove', { matchId, warm: true })
  assert.equal(warmed.version, beforeWarm.version)
  const afterWarm = (await getDoc(doc(alice.db, 'matches', matchId))).data()
  assert.equal(afterWarm.version, beforeWarm.version)
  assert.equal(afterWarm.history.length, beforeWarm.history.length)
  pass('warm-up call returns state without changing the match')

  await expectFailure(
    () => call(eve, 'submitMove', { matchId, warm: true }),
    'functions/permission-denied',
    'not-a-member',
  )
  pass('non-member cannot warm the move function')

  await expectFailure(
    () =>
      call(bob, 'submitMove', {
        matchId,
        requestId: 'bob-stale-0001',
        from: 'e7',
        to: 'e5',
        expectedVersion: 0,
      }),
    'functions/aborted',
    'stale-version',
  )
  pass('stale version is rejected')

  await expectFailure(
    () =>
      call(eve, 'submitMove', {
        matchId,
        requestId: 'eve-intruder-0001',
        from: 'e7',
        to: 'e5',
        expectedVersion: firstVersion,
      }),
    'functions/permission-denied',
    'not-a-member',
  )
  pass('non-member cannot submit moves')

  const second = await call(bob, 'submitMove', {
    matchId,
    requestId: 'bob-e7e5-0001',
    from: 'e7',
    to: 'e5',
    expectedVersion: firstVersion,
  })
  assert.ok(second.version > firstVersion)
  const afterSecond = await settleOffers(matchId, alice, bob)
  assert.equal(afterSecond.currentTurn, 'white')
  assert.equal(afterSecond.history.length, 2)
  assert.equal(afterSecond.history[1].san, 'e5')
  pass('black reply is applied and returned to White')

  const moveDoc = await getDoc(
    doc(bob.db, 'matches', matchId, 'moves', 'bob-e7e5-0001'),
  )
  assert.equal(moveDoc.exists(), true)
  assert.equal(moveDoc.data().playerUid, bobUid)
  assert.equal(moveDoc.data().version, second.version)
  pass('move document records the request, player, and version')

  const raceState = await settleOffers(matchId, alice, bob)
  const racePayload = {
    matchId,
    from: 'd2',
    to: 'd4',
    expectedVersion: raceState.version,
  }
  const race = await Promise.allSettled([
    call(alice, 'submitMove', {
      ...racePayload,
      requestId: 'alice-race-0001',
    }),
    call(alice, 'submitMove', {
      ...racePayload,
      requestId: 'alice-race-0002',
    }),
  ])
  const fulfilled = race.filter((result) => result.status === 'fulfilled')
  const rejected = race.filter((result) => result.status === 'rejected')
  assert.equal(fulfilled.length, 1)
  assert.equal(rejected.length, 1)
  // The loser may be rejected by the turn, version, or event check depending
  // on which state its transaction retried against after the winner committed.
  const raceRejection = rejected[0].reason
  assert.ok(
    raceRejection.code === 'functions/aborted' ||
      raceRejection.code === 'functions/failed-precondition',
    `unexpected race rejection ${raceRejection.code}`,
  )
  assert.ok(
    ['stale-version', 'wrong-turn', 'event-pending'].includes(
      raceRejection.details?.reason,
    ),
    `unexpected race reason ${raceRejection.details?.reason}`,
  )
  const afterRace = await settleOffers(matchId, alice, bob)
  assert.equal(afterRace.history.length, 3)
  assert.equal(afterRace.history[2].san, 'd4')
  pass('two racing submissions advance the match exactly once')

  console.log('\nPHASE 2 EMULATOR CHECK PASSED')
} finally {
  await Promise.all(clients.map((client) => deleteApp(client.app)))
}
