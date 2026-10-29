import { getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from 'firebase/firestore'
import {
  connectFunctionsEmulator,
  getFunctions,
  type Functions,
} from 'firebase/functions'
import { firebaseConfig, functionsRegion, useEmulators } from './config'

function currentApp(): FirebaseApp {
  const [existing] = getApps()
  return existing ?? initializeApp(firebaseConfig)
}

export const app = currentApp()
export const auth: Auth = getAuth(app)
export const db: Firestore = getFirestore(app)
export const functions: Functions = getFunctions(app, functionsRegion)

const EMULATOR_FLAG = '__chaosChessEmulatorsConnected'

if (useEmulators) {
  // Vite may re-evaluate this module during hot reload; connecting twice throws.
  const registry = globalThis as typeof globalThis & {
    [EMULATOR_FLAG]?: boolean
  }
  if (!registry[EMULATOR_FLAG]) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', {
      disableWarnings: true,
    })
    connectFirestoreEmulator(db, '127.0.0.1', 8080)
    connectFunctionsEmulator(functions, '127.0.0.1', 5001)
    registry[EMULATOR_FLAG] = true
  }
}
