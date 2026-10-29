import { useEffect, useState } from 'react'
import { getMyPrivateMatchState, OnlineError } from './api'

export interface PrivateHp {
  hp: number | null
  error: string | null
}

/**
 * Loads the caller's own HP. Refetches whenever the authoritative match
 * version changes, so server-side HP changes appear after the move that
 * caused them.
 */
export function usePrivateHp(
  matchId: string,
  version: number,
  enabled: boolean,
): PrivateHp {
  const [hp, setHp] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      return
    }
    let active = true

    getMyPrivateMatchState(matchId)
      .then((state) => {
        if (!active) {
          return
        }
        setHp(state.hp)
        setError(null)
      })
      .catch((caught: unknown) => {
        if (!active) {
          return
        }
        setError(
          caught instanceof OnlineError
            ? caught.message
            : 'Could not load your HP.',
        )
      })

    return () => {
      active = false
    }
  }, [matchId, version, enabled])

  return { hp, error }
}
