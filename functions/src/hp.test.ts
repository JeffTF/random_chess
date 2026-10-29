import { describe, expect, it } from 'vitest'
import { clampHp, hpEnding, MAX_HP, STARTING_HP } from './hp'

const WHITE = 'uid-white'
const BLACK = 'uid-black'

describe('HP rules', () => {
  it('starts players at 100 HP', () => {
    expect(STARTING_HP).toBe(100)
    expect(clampHp(STARTING_HP)).toBe(100)
  })

  it('clamps HP to the 0-100 range and rounds fractions', () => {
    expect(clampHp(101)).toBe(MAX_HP)
    expect(clampHp(1_000)).toBe(MAX_HP)
    expect(clampHp(-1)).toBe(0)
    expect(clampHp(-250)).toBe(0)
    expect(clampHp(63.4)).toBe(63)
    expect(clampHp(63.6)).toBe(64)
  })

  it('rejects non-finite HP values', () => {
    expect(() => clampHp(Number.NaN)).toThrow()
    expect(() => clampHp(Number.POSITIVE_INFINITY)).toThrow()
  })

  it('leaves the match running while both players have HP', () => {
    expect(hpEnding({ white: 100, black: 1 }, WHITE, BLACK)).toBeNull()
    expect(hpEnding({ white: 0.6, black: 0.6 }, WHITE, BLACK)).toBeNull()
  })

  it('ends the match for the depleted player', () => {
    expect(hpEnding({ white: 0, black: 40 }, WHITE, BLACK)).toEqual({
      status: 'finished',
      winnerUid: BLACK,
      endReason: 'hp-depleted',
    })

    expect(hpEnding({ white: 40, black: -5 }, WHITE, BLACK)).toEqual({
      status: 'finished',
      winnerUid: WHITE,
      endReason: 'hp-depleted',
    })
  })

  it('declares a draw when both players reach 0 HP', () => {
    expect(hpEnding({ white: 0, black: 0 }, WHITE, BLACK)).toEqual({
      status: 'finished',
      winnerUid: null,
      endReason: 'hp-depleted',
    })
  })
})
