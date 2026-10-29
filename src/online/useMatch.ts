import { doc, onSnapshot } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { db } from '../firebase/client'
import { normalizePublicMatch } from './normalize'
import type { PublicMatch } from './types'

export interface MatchState {
  match: PublicMatch | null
  loading: boolean
  error: string | null
}

export function useMatch(matchId: string | null): MatchState {
  const [state, setState] = useState<MatchState>({
    match: null,
    loading: Boolean(matchId),
    error: null,
  })

  useEffect(() => {
    if (!matchId) {
      setState({ match: null, loading: false, error: null })
      return
    }

    setState({ match: null, loading: true, error: null })

    const unsubscribe = onSnapshot(
      doc(db, 'matches', matchId),
      (snapshot) => {
        if (!snapshot.exists()) {
          setState({
            match: null,
            loading: false,
            error: 'That match no longer exists.',
          })
          return
        }
        setState({
          match: normalizePublicMatch(snapshot.data()),
          loading: false,
          error: null,
        })
      },
      () => {
        setState({
          match: null,
          loading: false,
          error:
            'Could not read the match. Check your connection, then reload.',
        })
      },
    )

    return unsubscribe
  }, [matchId])

  return state
}
