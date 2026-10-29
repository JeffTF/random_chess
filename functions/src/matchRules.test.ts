import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import { applyMove, MatchRuleError, sideOf } from './matchRules'
import type { MatchDocument } from './types'
import type { RandomSource } from '../../src/game/types'

const START_FEN = new Chess().fen()
const WHITE = 'uid-white'
const BLACK = 'uid-black'

function fixed(value: number): RandomSource {
  return () => value
}

function activeMatch(overrides: Partial<MatchDocument> = {}): MatchDocument {
  return {
    status: 'active',
    roomCode: 'ABC234',
    playerWhiteUid: WHITE,
    playerBlackUid: BLACK,
    currentTurn: 'white',
    fen: START_FEN,
    startFen: START_FEN,
    plyCount: 0,
    version: 0,
    history: [],
    lastMove: null,
    winnerUid: null,
    endReason: null,
    ...overrides,
  }
}

function reasonOf(action: () => unknown): string {
  try {
    action()
  } catch (error) {
    if (error instanceof MatchRuleError) {
      return error.reason
    }
    throw error
  }
  throw new Error('Expected a MatchRuleError to be thrown.')
}

describe('server-side move application', () => {
  it('applies a legal move with a server-chosen transformation', () => {
    const outcome = applyMove(
      activeMatch(),
      {
        playerUid: WHITE,
        expectedVersion: 0,
        from: 'e2',
        to: 'e4',
      },
      fixed(0),
    )

    expect(outcome.record.san).toBe('e4')
    expect(outcome.record.transformation).toEqual({ from: 'p', to: 'n' })
    expect(outcome.pieceBefore).toEqual({ type: 'p', color: 'w' })
    expect(outcome.pieceAfter).toEqual({ type: 'n', color: 'w' })
    expect(outcome.next.currentTurn).toBe('black')
    expect(outcome.next.version).toBe(1)
    expect(outcome.next.plyCount).toBe(1)
    expect(outcome.next.history).toHaveLength(1)
    expect(outcome.next.lastMove).toEqual({ from: 'e2', to: 'e4' })
    expect(outcome.next.status).toBe('active')
    expect(outcome.next.fen).toBe(outcome.record.fen)
  })

  it('rejects moves from non-members, wrong turns, and stale versions', () => {
    const state = activeMatch()

    expect(
      reasonOf(() =>
        applyMove(
          state,
          { playerUid: 'stranger', expectedVersion: 0, from: 'e2', to: 'e4' },
          fixed(0),
        ),
      ),
    ).toBe('not-a-member')

    expect(
      reasonOf(() =>
        applyMove(
          state,
          { playerUid: BLACK, expectedVersion: 0, from: 'e7', to: 'e5' },
          fixed(0),
        ),
      ),
    ).toBe('wrong-turn')

    expect(
      reasonOf(() =>
        applyMove(
          state,
          { playerUid: WHITE, expectedVersion: 3, from: 'e2', to: 'e4' },
          fixed(0),
        ),
      ),
    ).toBe('stale-version')
  })

  it('rejects illegal moves and matches that are not active', () => {
    expect(
      reasonOf(() =>
        applyMove(
          activeMatch(),
          { playerUid: WHITE, expectedVersion: 0, from: 'e2', to: 'e5' },
          fixed(0),
        ),
      ),
    ).toBe('invalid-move')

    expect(
      reasonOf(() =>
        applyMove(
          activeMatch({ status: 'waiting', playerBlackUid: null }),
          { playerUid: WHITE, expectedVersion: 0, from: 'e2', to: 'e4' },
          fixed(0),
        ),
      ),
    ).toBe('match-not-active')

    expect(
      reasonOf(() =>
        applyMove(
          activeMatch({ status: 'finished', endReason: 'checkmate' }),
          { playerUid: WHITE, expectedVersion: 0, from: 'e2', to: 'e4' },
          fixed(0),
        ),
      ),
    ).toBe('match-not-active')
  })

  it('requires promotion and transforms the promoted piece', () => {
    const state = activeMatch({
      fen: '4k3/P7/8/8/8/8/8/4K2R w - - 0 1',
      startFen: '4k3/P7/8/8/8/8/8/4K2R w - - 0 1',
    })

    expect(
      reasonOf(() =>
        applyMove(
          state,
          { playerUid: WHITE, expectedVersion: 0, from: 'a7', to: 'a8' },
          fixed(0),
        ),
      ),
    ).toBe('invalid-move')

    const outcome = applyMove(
      state,
      {
        playerUid: WHITE,
        expectedVersion: 0,
        from: 'a7',
        to: 'a8',
        promotion: 'q',
      },
      fixed(0),
    )

    expect(outcome.record.promotion).toBe('q')
    expect(outcome.record.transformation).toEqual({ from: 'q', to: 'n' })
    expect(outcome.pieceAfter).toEqual({ type: 'n', color: 'w' })
  })

  it('finishes the match on checkmate and awards the winner', () => {
    const mateFen = '7k/5Kp1/8/8/8/8/7B/7R w - - 0 1'
    const outcome = applyMove(
      activeMatch({ fen: mateFen, startFen: mateFen }),
      { playerUid: WHITE, expectedVersion: 0, from: 'h2', to: 'g3' },
      fixed(0),
    )

    expect(outcome.record.san).toBe('Bg3#')
    expect(outcome.next.status).toBe('finished')
    expect(outcome.next.endReason).toBe('checkmate')
    expect(outcome.next.winnerUid).toBe(WHITE)
    expect(outcome.next.currentTurn).toBe('black')
  })

  it('records the black player as winner when black mates', () => {
    const mateFen = '7K/5kP1/8/8/8/8/7b/7r b - - 0 1'
    const outcome = applyMove(
      activeMatch({
        fen: mateFen,
        startFen: mateFen,
        currentTurn: 'black',
      }),
      { playerUid: BLACK, expectedVersion: 0, from: 'h2', to: 'g3' },
      fixed(0),
    )

    expect(outcome.record.san).toBe('Bg3#')
    expect(outcome.next.status).toBe('finished')
    expect(outcome.next.winnerUid).toBe(BLACK)
  })

  it('maps stored colors to the right sides', () => {
    const state = activeMatch()
    expect(sideOf(state, WHITE)).toBe('white')
    expect(sideOf(state, BLACK)).toBe('black')
    expect(sideOf(state, 'stranger')).toBeNull()
  })
})
