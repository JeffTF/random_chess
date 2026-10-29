import { GAME_CONFIG } from '../../src/game/config'
import type {
  HpByUid,
  MatchDocument,
  PrivateMatchDocument,
} from './types'

export const STARTING_HP = GAME_CONFIG.hp.starting
export const MAX_HP = GAME_CONFIG.hp.max

export interface HpPair {
  white: number
  black: number
}

export interface HpEnding {
  status: 'finished'
  winnerUid: string | null
  endReason: 'hp-depleted'
}

export function clampHp(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error('HP must be a finite number.')
  }
  return Math.min(MAX_HP, Math.max(0, Math.round(value)))
}

export function startingHpFor(state: MatchDocument): HpByUid {
  const hp: HpByUid = {}
  if (state.playerWhiteUid) {
    hp[state.playerWhiteUid] = STARTING_HP
  }
  if (state.playerBlackUid) {
    hp[state.playerBlackUid] = STARTING_HP
  }
  return hp
}

/** Missing private documents default to full health (pre-Phase-3 matches). */
export function normalizePrivate(
  data: Partial<PrivateMatchDocument> | undefined,
): PrivateMatchDocument {
  return {
    hp: typeof data?.hp === 'number' ? clampHp(data.hp) : STARTING_HP,
    ...(data?.reverseUsed ? { reverseUsed: true } : {}),
  }
}

export function hpPairFor(state: MatchDocument, hp: HpByUid): HpPair {
  return {
    white: state.playerWhiteUid
      ? (hp[state.playerWhiteUid] ?? STARTING_HP)
      : STARTING_HP,
    black: state.playerBlackUid
      ? (hp[state.playerBlackUid] ?? STARTING_HP)
      : STARTING_HP,
  }
}

/**
 * HP depletion is evaluated after the chess position (see the resolution
 * order in the brief), so it takes precedence when both trigger on the
 * same ply: a player at 0 HP loses, and 0 HP on both sides is a draw.
 */
export function hpEnding(
  hp: HpPair,
  playerWhiteUid: string | null,
  playerBlackUid: string | null,
): HpEnding | null {
  const whiteDown = hp.white <= 0
  const blackDown = hp.black <= 0

  if (!whiteDown && !blackDown) {
    return null
  }

  return {
    status: 'finished',
    winnerUid:
      whiteDown && blackDown
        ? null
        : whiteDown
          ? playerBlackUid
          : playerWhiteUid,
    endReason: 'hp-depleted',
  }
}
