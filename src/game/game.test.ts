import { Chess, type Square } from 'chess.js'
import { describe, expect, it } from 'vitest'
import { ChaosChessGame } from './ChaosChessGame'
import { ChessRuleError } from './errors'
import type { RandomSource } from './types'

const FOOLS_MATE =
  'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'

function fixed(value: number): RandomSource {
  return () => value
}

function getRuleError(action: () => unknown): ChessRuleError {
  try {
    action()
  } catch (error) {
    if (error instanceof ChessRuleError) {
      return error
    }
    throw error
  }
  throw new Error('Expected a ChessRuleError to be thrown.')
}

function pieceOn(fen: string, square: Square) {
  return new Chess(fen).get(square)
}

describe('local chaos chess game', () => {
  it('starts from the standard position with twenty legal white moves', () => {
    const game = new ChaosChessGame({ random: fixed(0) })
    const startingSquares: Square[] = [
      'a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'h2',
      'b1', 'g1',
    ]

    expect(game.turn).toBe('w')
    expect(game.history).toHaveLength(0)
    expect(game.snapshot().status).toEqual({
      kind: 'active',
      inCheck: false,
    })
    expect(game.snapshot().version).toBe(0)

    const totalMoves = startingSquares.reduce(
      (total, square) => total + game.legalMovesFrom(square).length,
      0,
    )
    expect(totalMoves).toBe(20)
    expect(game.legalMovesFrom('e2')).toHaveLength(2)
    expect(game.legalMovesFrom('e7')).toEqual([])
  })

  it('applies a legal move and exactly one transformation', () => {
    const game = new ChaosChessGame({ random: fixed(0) })

    const record = game.move('e2', 'e4')

    expect(record.san).toBe('e4')
    expect(record.color).toBe('w')
    expect(record.from).toBe('e2')
    expect(record.to).toBe('e4')
    expect(record.transformation).toEqual({ from: 'p', to: 'n' })
    expect(record.promotion).toBeNull()
    expect(game.turn).toBe('b')
    expect(game.history).toEqual([record])
    expect(game.snapshot().version).toBe(1)
    expect(game.snapshot().lastMove).toEqual({
      from: 'e2',
      to: 'e4',
    })

    expect(pieceOn(game.fen, 'e2')).toBeUndefined()
    expect(pieceOn(game.fen, 'e4')).toEqual({ type: 'n', color: 'w' })
    expect(() => new Chess(game.fen)).not.toThrow()
  })

  it('rejects illegal, out-of-turn, and empty-square moves without changing state', () => {
    const game = new ChaosChessGame({ random: fixed(0) })
    const startingFen = game.fen

    expect(getRuleError(() => game.move('e2', 'e5')).code).toBe(
      'illegal-move',
    )
    expect(getRuleError(() => game.move('e7', 'e5')).code).toBe(
      'wrong-turn',
    )
    expect(getRuleError(() => game.move('a3', 'a4')).code).toBe('no-piece')

    expect(game.fen).toBe(startingFen)
    expect(game.history).toHaveLength(0)
    expect(game.turn).toBe('w')
    expect(game.snapshot().version).toBe(0)

    expect(() => game.move('e2', 'e4')).not.toThrow()
  })

  it('never transforms a king on a normal move', () => {
    const game = new ChaosChessGame({
      fen: 'r3k3/8/8/8/8/8/8/4K3 w - - 0 1',
      random: () => {
        throw new Error('Kings must not consume randomness.')
      },
    })

    const record = game.move('e1', 'f1')

    expect(record.transformation).toBeNull()
    expect(pieceOn(game.fen, 'f1')).toEqual({ type: 'k', color: 'w' })
    expect(game.turn).toBe('b')
  })

  it('leaves the castling rook in place and does not transform it', () => {
    const game = new ChaosChessGame({
      fen: 'r3k3/8/8/8/8/8/8/4K2R w K - 0 1',
      random: () => {
        throw new Error('Castling must not transform either piece.')
      },
    })

    const record = game.move('e1', 'g1')

    expect(record.san).toBe('O-O')
    expect(record.transformation).toBeNull()
    expect(pieceOn(game.fen, 'g1')).toEqual({ type: 'k', color: 'w' })
    expect(pieceOn(game.fen, 'f1')).toEqual({ type: 'r', color: 'w' })
    expect(pieceOn(game.fen, 'h1')).toBeUndefined()
  })

  it('requires a promotion choice before transforming the promoted piece', () => {
    const game = new ChaosChessGame({
      fen: '4k3/P7/8/8/8/8/8/4K2R w - - 0 1',
      random: fixed(0),
    })

    expect(getRuleError(() => game.move('a7', 'a8')).code).toBe(
      'promotion-required',
    )
    expect(game.history).toHaveLength(0)
    expect(game.turn).toBe('w')

    const record = game.move('a7', 'a8', 'q')

    expect(record.san).toBe('a8=Q+')
    expect(record.promotion).toBe('q')
    expect(record.transformation).toEqual({ from: 'q', to: 'n' })
    expect(pieceOn(game.fen, 'a8')).toEqual({ type: 'n', color: 'w' })
    expect(game.turn).toBe('b')
    expect(game.snapshot().status).toEqual({
      kind: 'active',
      inCheck: false,
    })
  })

  it('rejects promotion choices for non-promotion moves', () => {
    const game = new ChaosChessGame({
      fen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1',
      random: fixed(0),
    })

    expect(getRuleError(() => game.move('e1', 'e2', 'q')).code).toBe(
      'invalid-promotion',
    )
  })

  it('never creates a pawn on either promotion rank', () => {
    for (const value of [0, 0.3, 0.6, 0.99]) {
      const promotionGame = new ChaosChessGame({
        fen: '4k3/P7/8/8/8/8/8/4K3 w - - 0 1',
        random: fixed(value),
      })
      const promotionRecord = promotionGame.move('a7', 'a8', 'q')
      const promotedPiece = pieceOn(promotionGame.fen, 'a8')

      expect(promotedPiece?.type).not.toBe('p')
      expect(promotedPiece?.type).not.toBe('q')
      expect(promotionRecord.transformation).not.toBeNull()

      const rookGame = new ChaosChessGame({
        fen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1',
        random: fixed(value),
      })
      rookGame.move('a1', 'a8')

      expect(pieceOn(rookGame.fen, 'a8')?.type).not.toBe('p')
    }
  })

  it('recalculates check after the transformation', () => {
    const game = new ChaosChessGame({
      fen: '4k3/7p/8/8/3N4/8/P7/4K3 w - - 0 1',
      random: fixed(0.99),
    })

    const record = game.move('d4', 'b5')

    expect(record.san).toBe('Nb5')
    expect(record.transformation).toEqual({ from: 'n', to: 'q' })
    expect(pieceOn(game.fen, 'b5')).toEqual({ type: 'q', color: 'w' })
    expect(game.snapshot().inCheck).toBe(true)
    expect(game.snapshot().status).toEqual({
      kind: 'active',
      inCheck: true,
    })
  })

  it('detects checkmate after an ordinary move and transformation', () => {
    const game = new ChaosChessGame({
      fen: '7k/5Kp1/8/8/8/8/7B/7R w - - 0 1',
      random: fixed(0),
    })

    const record = game.move('h2', 'g3')
    const snapshot = game.snapshot()

    expect(record.san).toBe('Bg3#')
    expect(record.transformation).toEqual({ from: 'b', to: 'p' })
    expect(snapshot.inCheck).toBe(true)
    expect(snapshot.status).toEqual({ kind: 'checkmate', winner: 'w' })
    expect(new Chess(snapshot.fen).isCheckmate()).toBe(true)
    expect(getRuleError(() => game.move('h8', 'h7')).code).toBe('game-over')
  })

  it('reports check and checkmate from loaded positions', () => {
    const checkGame = new ChaosChessGame({
      fen: '4k3/8/8/8/8/8/4R3/4K3 b - - 0 1',
      random: fixed(0),
    })
    expect(checkGame.snapshot().status).toEqual({
      kind: 'active',
      inCheck: true,
    })

    const mateGame = new ChaosChessGame({
      fen: FOOLS_MATE,
      random: fixed(0),
    })
    expect(mateGame.snapshot().status).toEqual({
      kind: 'checkmate',
      winner: 'b',
    })
    expect(getRuleError(() => mateGame.move('e1', 'e2')).code).toBe(
      'game-over',
    )
  })

  it('detects stalemate, insufficient material, and the fifty-move rule', () => {
    const stalemate = new ChaosChessGame({
      fen: 'k7/2K5/1Q6/8/8/8/8/8 b - - 0 1',
      random: fixed(0),
    })
    expect(stalemate.snapshot().status).toEqual({
      kind: 'draw',
      reason: 'stalemate',
    })

    const insufficient = new ChaosChessGame({
      fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
      random: fixed(0),
    })
    expect(insufficient.snapshot().status).toEqual({
      kind: 'draw',
      reason: 'insufficient-material',
    })

    const fiftyMoves = new ChaosChessGame({
      fen: '4k3/8/8/8/8/8/8/R3K3 w - - 100 60',
      random: fixed(0),
    })
    expect(fiftyMoves.snapshot().status).toEqual({
      kind: 'draw',
      reason: 'fifty-move-rule',
    })
  })

  it('tracks threefold repetition across transformed positions', () => {
    const game = new ChaosChessGame({
      fen: '7k/8/8/8/8/8/P7/2R1K3 w - - 0 1',
      random: fixed(0.9),
    })

    const oneCycle: Array<[Square, Square]> = [
      ['c1', 'd1'],
      ['h8', 'g8'],
      ['d1', 'c1'],
      ['g8', 'h8'],
    ]

    for (const [from, to] of oneCycle) {
      game.move(from, to)
    }
    expect(game.snapshot().status.kind).toBe('active')

    for (const [from, to] of oneCycle) {
      game.move(from, to)
    }
    expect(game.snapshot().status).toEqual({
      kind: 'draw',
      reason: 'threefold-repetition',
    })
  })

  it('cancels en passant when the double-pushed pawn transforms', () => {
    const game = new ChaosChessGame({
      fen: '4k3/8/8/8/3p4/8/4P3/4K3 w - - 0 1',
      random: fixed(0),
    })

    game.move('e2', 'e4')

    expect(pieceOn(game.fen, 'e4')).toEqual({ type: 'n', color: 'w' })
    expect(game.fen.split(' ')[3]).toBe('-')
    expect(
      game.legalMovesFrom('d4').map((move) => move.to),
    ).not.toContain('e3')
  })

  it('can represent unusual transformed material such as two queens', () => {
    const game = new ChaosChessGame({
      fen: '4k3/8/8/8/8/8/P7/R2QK3 w - - 0 1',
      random: fixed(0.99),
    })

    const record = game.move('a1', 'b1')

    expect(record.transformation).toEqual({ from: 'r', to: 'q' })
    expect(new Chess(game.fen).findPiece({ type: 'q', color: 'w' })).toEqual(
      expect.arrayContaining(['b1', 'd1']),
    )
    expect(() => new Chess(game.fen)).not.toThrow()
  })
})
