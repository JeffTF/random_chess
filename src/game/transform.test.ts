import { describe, expect, it } from 'vitest'
import { GAME_CONFIG } from './config'
import { randomIndex } from './random'
import {
  chooseTransformation,
  isTransformablePiece,
  squareRank,
  transformationCandidates,
} from './transform'

describe('transformation rules', () => {
  it('identifies transformable pieces but not kings', () => {
    expect(isTransformablePiece('k')).toBe(false)
    for (const type of ['p', 'n', 'b', 'r', 'q'] as const) {
      expect(isTransformablePiece(type)).toBe(true)
    }
  })

  it('never includes the current piece type', () => {
    for (const type of ['p', 'n', 'b', 'r', 'q'] as const) {
      const candidates = transformationCandidates(type, 'd4')
      expect(candidates).not.toContain(type)
      expect(candidates.length).toBeGreaterThan(0)
    }
  })

  it('excludes pawns on both promotion ranks but allows them elsewhere', () => {
    expect(transformationCandidates('n', 'a8')).not.toContain('p')
    expect(transformationCandidates('n', 'h1')).not.toContain('p')
    expect(transformationCandidates('n', 'a7')).toContain('p')
    expect(transformationCandidates('n', 'h2')).toContain('p')
    expect(squareRank('a8')).toBe(8)
    expect(squareRank('h1')).toBe(1)
  })

  it('chooses over the candidate list deterministically', () => {
    expect(chooseTransformation('n', 'd4', () => 0)).toBe('p')
    expect(chooseTransformation('n', 'd4', () => 0.99)).toBe('q')
    expect(chooseTransformation('n', 'a8', () => 0.99)).toBe('q')
  })

  it('never selects a pawn on a promotion rank regardless of randomness', () => {
    for (const value of [0, 0.2, 0.4, 0.6, 0.8, 0.999]) {
      const selected = chooseTransformation('n', 'a8', () => value)
      expect(selected).not.toBe('n')
      expect(selected).not.toBe('p')
    }
  })

  it('rejects kings and empty candidate lists explicitly', () => {
    expect(() => chooseTransformation('k', 'd4', () => 0)).toThrow(
      'Kings never transform.',
    )

    expect(() =>
      chooseTransformation('n', 'd4', () => 0, {
        candidateTypes: ['n'],
        pawnForbiddenRanks: GAME_CONFIG.transformation.pawnForbiddenRanks,
      }),
    ).toThrow('No valid transformation type is available.')
  })

  it('clamps random source values into the candidate range', () => {
    expect(randomIndex(() => 1, 3)).toBe(2)
    expect(randomIndex(() => -1, 3)).toBe(0)
    expect(() => randomIndex(() => Number.NaN, 3)).toThrow(
      'Random source must return a finite number.',
    )
  })
})
