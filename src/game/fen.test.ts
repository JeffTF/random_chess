import { describe, expect, it } from 'vitest'
import {
  PositionTracker,
  positionKey,
  replacePieceInFen,
} from './fen'

const BASE_FEN = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1'

describe('FEN helpers', () => {
  it('replaces a piece and clears the en passant target', () => {
    const fen = replacePieceInFen(
      '4k3/8/8/8/4p3/8/4P3/4K3 w - e3 0 1',
      'e4',
      { type: 'n', color: 'w' },
    )

    expect(fen).toBe('4k3/8/8/8/4N3/8/4P3/4K3 w - - 0 1')
    expect(fen.split(' ')[3]).toBe('-')
  })

  it('can replace a piece without touching other FEN fields', () => {
    const fen = replacePieceInFen(
      BASE_FEN,
      'a8',
      { type: 'q', color: 'w' },
      { clearEnPassant: false },
    )

    expect(fen).toBe('Q3k3/P7/8/8/8/8/8/4K3 w - - 0 1')
  })

  it('builds repetition keys from position and turn only', () => {
    expect(positionKey('8/8/8/8/8/8/8/K6k w - - 0 1')).toBe(
      positionKey('8/8/8/8/8/8/8/K6k w - - 99 50'),
    )
    expect(positionKey('8/8/8/8/8/8/8/K6k w - - 0 1')).not.toBe(
      positionKey('8/8/8/8/8/8/8/K6k b - - 0 1'),
    )
  })

  it('tracks every occurrence of a position', () => {
    const tracker = new PositionTracker('8/8/8/8/8/8/8/K6k w - - 0 1')

    expect(tracker.count('8/8/8/8/8/8/8/K6k w - - 4 4')).toBe(1)
    tracker.record('8/8/8/8/8/8/8/K6k w - - 4 4')
    tracker.record('8/8/8/8/8/8/8/K6k w - - 8 8')

    expect(tracker.count('8/8/8/8/8/8/8/K6k w - - 0 1')).toBe(3)
  })

  it('rejects malformed FEN or square input', () => {
    expect(() =>
      replacePieceInFen('not-a-fen', 'a8', { type: 'q', color: 'w' }),
    ).toThrow('Invalid FEN')
    expect(() =>
      replacePieceInFen(BASE_FEN, 'z9' as never, { type: 'q', color: 'w' }),
    ).toThrow('Invalid square')
  })
})
