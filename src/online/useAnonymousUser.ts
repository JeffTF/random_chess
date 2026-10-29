import { onAuthStateChanged, signInAnonymously } from 'firebase/auth'
import { useEffect, useState } from 'react'
import { auth } from '../firebase/client'

export type UserState =
  | { status: 'loading' }
  | { status: 'ready'; uid: string }
  | { status: 'error'; message: string }

let pendingSignIn: Promise<string> | null = null

function signInOnce(): Promise<string> {
  pendingSignIn ??= signInAnonymously(auth)
    .then((credential) => credential.user.uid)
    .finally(() => {
      pendingSignIn = null
    })
  return pendingSignIn
}

export function describeAuthError(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'auth/operation-not-allowed') {
    return 'Anonymous sign-in is disabled for this project. Enable it under Authentication → Sign-in method.'
  }
  if (code === 'auth/network-request-failed') {
    return 'Could not reach Firebase Authentication. Check your connection.'
  }
  if (code === 'auth/unauthorized-domain') {
    return 'This domain is not authorised for Firebase Authentication.'
  }
  return 'Could not sign in. Reload the page to try again.'
}

export function useAnonymousUser(): UserState {
  const [state, setState] = useState<UserState>({ status: 'loading' })

  useEffect(() => {
    let active = true

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!active) {
        return
      }
      if (user) {
        setState({ status: 'ready', uid: user.uid })
        return
      }

      signInOnce()
        .then((uid) => {
          if (active) {
            setState({ status: 'ready', uid })
          }
        })
        .catch((error: unknown) => {
          if (active) {
            setState({
              status: 'error',
              message: describeAuthError(error),
            })
          }
        })
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return state
}
