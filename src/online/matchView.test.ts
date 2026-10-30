import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import { predictMove } from './matchView'

const START_FEN = new Chess().fen()

describe('predictMove', () => {
  it('applies a legal move to a throwaway board', () => {
    const predicted = predictMove(START_FEN, 'e2', 'e4')

    expect(predicted).not.toBeNull()
    expect(predicted!.board[4]![4]).toMatchObject({ type: 'p', color: 'w' })
    expect(predicted!.board[6]![4]).toBeNull()
    expect(predicted!.chess.turn()).toBe('b')
  })

  it('rejects an illegal move instead of guessing', () => {
    expect(predictMove(START_FEN, 'e2', 'e5')).toBeNull()
  })

  it('carries a requested promotion', () => {
    const predicted = predictMove(
      '8/P7/8/8/8/8/8/K6k w - - 0 1',
      'a7',
      'a8',
      'q',
    )

    expect(predicted).not.toBeNull()
    expect(predicted!.board[0]![0]).toMatchObject({ type: 'q', color: 'w' })
  })
})
