export type GameErrorCode =
  | 'game-over'
  | 'no-piece'
  | 'wrong-turn'
  | 'illegal-move'
  | 'promotion-required'
  | 'invalid-promotion'
  | 'invalid-transformation'

export class ChessRuleError extends Error {
  readonly code: GameErrorCode

  constructor(code: GameErrorCode, message: string) {
    super(message)
    this.name = 'ChessRuleError'
    this.code = code
  }
}
