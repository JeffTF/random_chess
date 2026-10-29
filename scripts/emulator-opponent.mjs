// Joins a room as Black and (optionally) plays one move after the board
// reaches a given version. Used to exercise the UI with a second player:
//   node scripts/emulator-opponent.mjs <roomCode> [from] [to] [waitVersion]
import { deleteApp, initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  doc,
  getFirestore,
  onSnapshot,
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

const [roomCode, from, to, waitVersionArg] = process.argv.slice(2)
if (!roomCode) {
  console.error('Usage: node scripts/emulator-opponent.mjs <roomCode> [from] [to] [waitVersion]')
  process.exit(1)
}
const waitVersion = Number(waitVersionArg ?? 1)

const app = initializeApp(CONFIG, `opponent-${Date.now()}`)
const auth = getAuth(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', {
  disableWarnings: true,
})
const db = getFirestore(app)
connectFirestoreEmulator(db, '127.0.0.1', 8080)
const functions = getFunctions(app, REGION)
connectFunctionsEmulator(functions, '127.0.0.1', 5001)

const user = (await signInAnonymously(auth)).user
const joinResult = await httpsCallable(functions, 'joinMatch')({ roomCode })
const matchId = joinResult.data.matchId
console.log(`JOINED match=${matchId} uid=${user.uid}`)

if (!from || !to) {
  await deleteApp(app)
  process.exit(0)
}

const timeout = setTimeout(() => {
  console.error('TIMEOUT waiting for the board to reach version', waitVersion)
  process.exit(2)
}, 120_000)

const unsubscribe = onSnapshot(doc(db, 'matches', matchId), (snapshot) => {
  const match = snapshot.data()
  if (match.version < waitVersion || match.currentTurn !== 'black') {
    return
  }
  unsubscribe()
  clearTimeout(timeout)

  httpsCallable(functions, 'submitMove')({
    matchId,
    requestId: crypto.randomUUID(),
    from,
    to,
    expectedVersion: match.version,
  })
    .then((result) => {
      console.log(`OPPONENT_MOVED version=${result.data.version} ${from}-${to}`)
      return deleteApp(app)
    })
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('MOVE_FAILED', error.code, error.message)
      process.exit(3)
    })
})
