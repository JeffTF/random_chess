import { doc, onSnapshot } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { db } from '../firebase/client'

export interface PrivateHp {
  hp: number | null
  error: string | null
}

/**
 * Subscribes to the caller's own private document. The security rules only
 * allow the owner to read it, so the opponent's HP never reaches this client.
 * A listener replaces the old per-version fetch, which cost one serverless
 * invocation for every move in the match.
 */
export function usePrivateHp(
  matchId: string,
  uid: string | null,
  enabled: boolean,
): PrivateHp {
  const [hp, setHp] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setHp(null)
    setError(null)
    if (!enabled || !uid) {
      return
    }

    const unsubscribe = onSnapshot(
      doc(db, 'matches', matchId, 'private', uid),
      (snapshot) => {
        const value = snapshot.data()?.hp
        setHp(typeof value === 'number' ? value : null)
        setError(null)
      },
      () => {
        setError('Could not load your HP. Check your connection.')
      },
    )

    return unsubscribe
  }, [matchId, uid, enabled])

  return { hp, error }
}
