import { EVENT_TUNING, type EventTuning } from '../../src/game/events'

function readNumber(
  name: string,
  fallback: number,
  isValid: (value: number) => boolean,
): number {
  const raw = process.env[name]
  if (!raw) {
    return fallback
  }
  const value = Number(raw)
  return Number.isFinite(value) && isValid(value) ? value : fallback
}

/**
 * Event tuning can be overridden per environment without rebuilding the
 * shared catalogue. Values outside sane ranges fall back to the defaults.
 */
export function eventTuning(): EventTuning {
  return {
    ...EVENT_TUNING,
    offerChance: readNumber(
      'CHAOS_EVENT_CHANCE',
      EVENT_TUNING.offerChance,
      (value) => value >= 0 && value <= 1,
    ),
    minGapPlies: readNumber(
      'CHAOS_EVENT_MIN_GAP_PLIES',
      EVENT_TUNING.minGapPlies,
      (value) => Number.isInteger(value) && value >= 0,
    ),
    responseTimeoutMs: readNumber(
      'CHAOS_EVENT_TIMEOUT_MS',
      EVENT_TUNING.responseTimeoutMs,
      (value) => Number.isInteger(value) && value >= 1000,
    ),
  }
}
