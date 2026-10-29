import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import { applyMove, MatchRuleError, sideOf } from './matchRules'
import type { MatchDocument } from './types'
import type { RandomSource } from '../../src/game/types'

const START_FEN = new Chess().fen()
const BLACK_TO_MOVE_FEN =
  'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
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
    event: null,
    effects: { bombs: [], shields: [], hijack: null },
    lastEvent: null,
    lastEventPly: null,
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

    expect(outcome.record!.san).toBe('e4')
    expect(outcome.record!.transformation).toEqual({ from: 'p', to: 'n' })
    expect(outcome.pieceBefore).toEqual({ type: 'p', color: 'w' })
    expect(outcome.pieceAfter).toEqual({ type: 'n', color: 'w' })
    expect(outcome.next.currentTurn).toBe('black')
    expect(outcome.next.version).toBe(1)
    expect(outcome.next.plyCount).toBe(1)
    expect(outcome.next.history).toHaveLength(1)
    expect(outcome.next.lastMove).toEqual({ from: 'e2', to: 'e4' })
    expect(outcome.next.status).toBe('active')
    expect(outcome.next.fen).toBe(outcome.record!.fen)
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

    expect(outcome.record!.promotion).toBe('q')
    expect(outcome.record!.transformation).toEqual({ from: 'q', to: 'n' })
    expect(outcome.pieceAfter).toEqual({ type: 'n', color: 'w' })
  })

  it('finishes the match on checkmate and awards the winner', () => {
    const mateFen = '7k/5Kp1/8/8/8/8/7B/7R w - - 0 1'
    const outcome = applyMove(
      activeMatch({ fen: mateFen, startFen: mateFen }),
      { playerUid: WHITE, expectedVersion: 0, from: 'h2', to: 'g3' },
      fixed(0),
    )

    expect(outcome.record!.san).toBe('Bg3#')
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

    expect(outcome.record!.san).toBe('Bg3#')
    expect(outcome.next.status).toBe('finished')
    expect(outcome.next.winnerUid).toBe(BLACK)
  })

  it('lets HP depletion override a simultaneous checkmate', () => {
    const mateFen = '7k/5Kp1/8/8/8/8/7B/7R w - - 0 1'
    const outcome = applyMove(
      activeMatch({ fen: mateFen, startFen: mateFen }),
      { playerUid: WHITE, expectedVersion: 0, from: 'h2', to: 'g3' },
      fixed(0),
      { [WHITE]: 0, [BLACK]: 100 },
    )

    expect(outcome.record!.san).toBe('Bg3#')
    expect(outcome.next.status).toBe('finished')
    expect(outcome.next.endReason).toBe('hp-depleted')
    expect(outcome.next.winnerUid).toBe(BLACK)
  })

  it('declares a draw when both players are at 0 HP after a move', () => {
    const mateFen = '7k/5Kp1/8/8/8/8/7B/7R w - - 0 1'
    const outcome = applyMove(
      activeMatch({ fen: mateFen, startFen: mateFen }),
      { playerUid: WHITE, expectedVersion: 0, from: 'h2', to: 'g3' },
      fixed(0),
      { [WHITE]: 0, [BLACK]: 0 },
    )

    expect(outcome.next.status).toBe('finished')
    expect(outcome.next.endReason).toBe('hp-depleted')
    expect(outcome.next.winnerUid).toBeNull()
  })

  it('keeps the match active while both players have HP', () => {
    const outcome = applyMove(
      activeMatch(),
      { playerUid: WHITE, expectedVersion: 0, from: 'e2', to: 'e4' },
      fixed(0),
      { [WHITE]: 1, [BLACK]: 1 },
    )

    expect(outcome.next.status).toBe('active')
    expect(outcome.next.endReason).toBeNull()
  })

  it('maps stored colors to the right sides', () => {
    const state = activeMatch()
    expect(sideOf(state, WHITE)).toBe('white')
    expect(sideOf(state, BLACK)).toBe('black')
    expect(sideOf(state, 'stranger')).toBeNull()
  })
})

describe('move-triggered event effects', () => {
  it('cancels a capture against a shielded piece and consumes the shield', () => {
    const fen = '4k3/8/8/8/4n3/5P2/8/4K3 w - - 0 1'
    const state = activeMatch({
      fen,
      startFen: fen,
      effects: {
        bombs: [],
        shields: [{ square: 'e4', side: 'black' }],
        hijack: null,
      },
    })

    const outcome = applyMove(
      state,
      { playerUid: WHITE, expectedVersion: 0, from: 'f3', to: 'e4' },
      fixed(0),
    )

    expect(outcome.blocked).toBe('shield')
    expect(outcome.record).toBeNull()
    expect(outcome.next.fen).toBe(fen)
    expect(outcome.next.currentTurn).toBe('white')
    expect(outcome.next.version).toBe(1)
    expect(outcome.next.effects.shields).toEqual([])
  })

  it('damages the capturer when a friendly bomb is captured', () => {
    const fen = '4k3/8/8/3p4/4P3/8/8/4K3 b - - 0 1'
    const state = activeMatch({
      fen,
      startFen: fen,
      currentTurn: 'black',
      effects: {
        bombs: [
          { square: 'e4', side: 'white', kind: 'friendly', movesLeft: null },
        ],
        shields: [],
        hijack: null,
      },
    })

    const outcome = applyMove(
      state,
      { playerUid: BLACK, expectedVersion: 0, from: 'd5', to: 'e4' },
      fixed(0),
    )

    expect(outcome.record!.effects?.bombDamage).toBe(10)
    expect(outcome.hp[BLACK]).toBe(90)
    expect(outcome.hp[WHITE]).toBe(100)
    expect(outcome.next.effects.bombs).toEqual([])
  })

  it('damages the mover when they move a triple-bombed piece', () => {
    const state = activeMatch({
      fen: BLACK_TO_MOVE_FEN,
      startFen: BLACK_TO_MOVE_FEN,
      currentTurn: 'black',
      effects: {
        bombs: [
          { square: 'b8', side: 'black', kind: 'triple', movesLeft: 2 },
        ],
        shields: [],
        hijack: null,
      },
    })

    const outcome = applyMove(
      state,
      {
        playerUid: BLACK,
        expectedVersion: 0,
        from: 'b8',
        to: 'c6',
      },
      fixed(0),
    )

    expect(outcome.record!.effects?.bombDamage).toBe(10)
    expect(outcome.hp[BLACK]).toBe(90)
    expect(outcome.next.effects.bombs).toEqual([])
  })

  it('expires triple bombs after two moves by the bombed side', () => {
    const fen = '4k2n/p7/8/8/8/8/8/4K3 b - - 0 1'
    let state = activeMatch({
      fen,
      startFen: fen,
      currentTurn: 'black',
      effects: {
        bombs: [
          { square: 'h8', side: 'black', kind: 'triple', movesLeft: 2 },
        ],
        shields: [],
        hijack: null,
      },
    })

    state = applyMove(
      state,
      { playerUid: BLACK, expectedVersion: 0, from: 'a7', to: 'a6' },
      fixed(0),
    ).next
    expect(state.effects.bombs).toHaveLength(1)
    expect(state.effects.bombs[0]!.movesLeft).toBe(1)

    state = applyMove(
      state,
      { playerUid: WHITE, expectedVersion: 1, from: 'e1', to: 'd1' },
      fixed(0),
    ).next
    expect(state.effects.bombs).toHaveLength(1)

    state = applyMove(
      state,
      { playerUid: BLACK, expectedVersion: 2, from: 'e8', to: 'e7' },
      fixed(0),
    ).next
    expect(state.effects.bombs).toEqual([])
  })

  it('transfers the opponent’s next moved piece through a hijack', () => {
    const state = activeMatch({
      fen: BLACK_TO_MOVE_FEN,
      startFen: BLACK_TO_MOVE_FEN,
      currentTurn: 'black',
      effects: { bombs: [], shields: [], hijack: { byUid: WHITE } },
    })

    const outcome = applyMove(
      state,
      {
        playerUid: BLACK,
        expectedVersion: 0,
        from: 'b8',
        to: 'c6',
      },
      fixed(0),
    )

    expect(outcome.record!.effects?.hijacked).toBe(true)
    expect(outcome.next.effects.hijack).toBeNull()
    const transferred = new Chess(outcome.next.fen).get('c6')
    expect(transferred?.color).toBe('w')
    expect(outcome.next.history.at(-1)!.fen).toBe(outcome.next.fen)
  })

  it('consumes a hijack without effect when a king moves', () => {
    const fen = '4k3/8/8/8/8/8/7p/4K3 b - - 0 1'
    const state = activeMatch({
      fen,
      startFen: fen,
      currentTurn: 'black',
      effects: { bombs: [], shields: [], hijack: { byUid: WHITE } },
    })

    const outcome = applyMove(
      state,
      { playerUid: BLACK, expectedVersion: 0, from: 'e8', to: 'e7' },
      fixed(0),
    )

    expect(outcome.next.effects.hijack).toBeNull()
    expect(outcome.record!.effects).toBeUndefined()
    const king = new Chess(outcome.next.fen).get('e7')
    expect(king?.color).toBe('b')
  })

  it('ends the match when bomb damage reaches zero HP', () => {
    const state = activeMatch({
      fen: BLACK_TO_MOVE_FEN,
      startFen: BLACK_TO_MOVE_FEN,
      currentTurn: 'black',
      effects: {
        bombs: [
          { square: 'b8', side: 'black', kind: 'triple', movesLeft: 2 },
        ],
        shields: [],
        hijack: null,
      },
    })

    const outcome = applyMove(
      state,
      {
        playerUid: BLACK,
        expectedVersion: 0,
        from: 'b8',
        to: 'c6',
      },
      fixed(0),
      { [WHITE]: 100, [BLACK]: 10 },
    )

    expect(outcome.next.status).toBe('finished')
    expect(outcome.next.endReason).toBe('hp-depleted')
    expect(outcome.next.winnerUid).toBe(WHITE)
  })
})
