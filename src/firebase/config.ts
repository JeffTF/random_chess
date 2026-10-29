export interface FirebaseWebConfig {
  apiKey: string
  authDomain: string
  projectId: string
  storageBucket: string
  messagingSenderId: string
  appId: string
}

function readEnv(name: string): string {
  const value = import.meta.env[name]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `Missing Firebase configuration value ${name}. Copy .env.example to .env.local and fill it in.`,
    )
  }
  return value.trim()
}

export const firebaseConfig: FirebaseWebConfig = {
  apiKey: readEnv('VITE_FIREBASE_API_KEY'),
  authDomain: readEnv('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: readEnv('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: readEnv('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: readEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: readEnv('VITE_FIREBASE_APP_ID'),
}

export const functionsRegion =
  import.meta.env.VITE_FIREBASE_REGION?.trim() || 'us-central1'

// Development uses the Emulator Suite by default; production builds
// always talk to the real project unless explicitly overridden.
export const useEmulators =
  import.meta.env.VITE_USE_FIREBASE_EMULATORS === undefined
    ? import.meta.env.DEV
    : import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'
