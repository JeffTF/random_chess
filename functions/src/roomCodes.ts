import { secureRandomInt } from './random'

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const ROOM_CODE_LENGTH = 6

export function generateRoomCode(): string {
  let code = ''
  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    code += ROOM_CODE_ALPHABET[secureRandomInt(ROOM_CODE_ALPHABET.length)]
  }
  return code
}

export function normalizeRoomCode(input: unknown): string {
  if (typeof input !== 'string') {
    throw new Error('A room code is required.')
  }

  const code = input.trim().toUpperCase()
  if (code.length !== ROOM_CODE_LENGTH) {
    throw new Error(`Room codes are ${ROOM_CODE_LENGTH} characters.`)
  }
  for (const character of code) {
    if (!ROOM_CODE_ALPHABET.includes(character)) {
      throw new Error('That room code contains invalid characters.')
    }
  }
  return code
}
