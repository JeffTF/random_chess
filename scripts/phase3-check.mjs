// End-to-end check of Phase 3 (HP privacy) against the Firebase
// Emulator Suite. Run after `npm run emulators` is up:
//   node scripts/phase3-check.mjs
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

function pass(label) {
  console.log(`PASS  ${label}`)
}

// Moves can raise a random event offer (Phase 4). Settle it through the
// offered player so this HP-focused check stays independent of events.
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
  pass(`createMatch returned room ${roomCode}`)

  const ownState = await call(alice, 'getMyPrivateMatchState', { matchId })
  assert.deepEqual(ownState, { hp: 100 })
  pass('creator starts at 100 HP through the callable')

  const ownDoc = await getDoc(
    doc(alice.db, 'matches', matchId, 'private', aliceUid),
  )
  assert.equal(ownDoc.exists(), true)
  assert.equal(ownDoc.data().hp, 100)
  pass('creator can read their own private HP document')

  await expectFailure(
    () => getDoc(doc(alice.db, 'matches', matchId, 'private', bobUid)),
    'permission-denied',
  )
  pass('creator cannot read the opponent private document')

  await call(bob, 'joinMatch', { roomCode })
  const bobState = await call(bob, 'getMyPrivateMatchState', { matchId })
  assert.deepEqual(bobState, { hp: 100 })
  pass('joiner starts at 100 HP through the callable')

  const bobDoc = await getDoc(
    doc(bob.db, 'matches', matchId, 'private', bobUid),
  )
  assert.equal(bobDoc.data().hp, 100)
  pass('joiner can read their own private HP document')

  await expectFailure(
    () => getDoc(doc(bob.db, 'matches', matchId, 'private', aliceUid)),
    'permission-denied',
  )
  pass('joiner cannot read the creator private document')

  await expectFailure(
    () => getDoc(doc(eve.db, 'matches', matchId, 'private', aliceUid)),
    'permission-denied',
  )
  pass('non-member cannot read any private document')

  await expectFailure(
    () => call(eve, 'getMyPrivateMatchState', { matchId }),
    'functions/permission-denied',
    'not-a-member',
  )
  pass('non-member cannot call getMyPrivateMatchState')

  const matchData = (await getDoc(doc(alice.db, 'matches', matchId))).data()
  assert.equal(findKey(matchData, 'hp'), null)
  assert.equal(findKey(matchData, 'private'), null)
  pass('public match document contains no HP or private state')

  await expectFailure(
    () => call(alice, 'getMyPrivateMatchState', { matchId: 'missing-match' }),
    'functions/not-found',
  )
  pass('unknown match is rejected')

  await expectFailure(
    () => call(alice, 'getMyPrivateMatchState', { matchId: '../escape' }),
    'functions/invalid-argument',
  )
  pass('malformed matchId is rejected')

  await call(alice, 'submitMove', {
    matchId,
    requestId: 'phase3-alice-e2e4-0001',
    from: 'e2',
    to: 'e4',
    expectedVersion: 0,
  })

  const afterMove = await settleOffers(matchId, alice, bob)
  assert.ok(afterMove.version >= 1)
  assert.equal(afterMove.history.length, 1)
  assert.equal(findKey(afterMove, 'hp'), null)
  assert.deepEqual(await call(alice, 'getMyPrivateMatchState', { matchId }), {
    hp: 100,
  })
  assert.deepEqual(await call(bob, 'getMyPrivateMatchState', { matchId }), {
    hp: 100,
  })
  pass('HP stays 100 after a move and never enters public state')

  console.log('\nPHASE 3 EMULATOR CHECK PASSED')
} finally {
  await Promise.all(clients.map((client) => deleteApp(client.app)))
}
