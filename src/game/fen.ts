import type { Color, PieceSymbol, Square } from 'chess.js'

function expandPlacementRow(row: string): Array<string | null> {
  const cells: Array<string | null> = []

  for (const token of row) {
    if (/\d/.test(token)) {
      const emptyCount = Number(token)
      for (let index = 0; index < emptyCount; index += 1) {
        cells.push(null)
      }
    } else {
      cells.push(token)
    }
  }

  if (cells.length !== 8) {
    throw new Error(`Invalid FEN row: ${row}`)
  }

  return cells
}

function compressPlacementRow(cells: ReadonlyArray<string | null>): string {
  let compressed = ''
  let emptyCount = 0

  for (const cell of cells) {
    if (cell === null) {
      emptyCount += 1
      continue
    }

    if (emptyCount > 0) {
      compressed += String(emptyCount)
      emptyCount = 0
    }
    compressed += cell
  }

  if (emptyCount > 0) {
    compressed += String(emptyCount)
  }

  return compressed
}

export function positionKey(fen: string): string {
  return fen.trim().split(/\s+/).slice(0, 4).join(' ')
}

export function replacePieceInFen(
  fen: string,
  square: Square,
  piece: { type: PieceSymbol; color: Color },
  { clearEnPassant = true }: { clearEnPassant?: boolean } = {},
): string {
  const fields = fen.trim().split(/\s+/)
  if (fields.length !== 6) {
    throw new Error(`Invalid FEN: ${fen}`)
  }

  const file = square.charCodeAt(0) - 'a'.charCodeAt(0)
  const rank = Number(square[1])
  if (file < 0 || file > 7 || rank < 1 || rank > 8 || Number.isNaN(rank)) {
    throw new Error(`Invalid square: ${square}`)
  }

  const rows = fields[0]!.split('/')
  const rowIndex = 8 - rank
  const row = rows[rowIndex]
  if (!row) {
    throw new Error(`Invalid FEN: ${fen}`)
  }

  const cells = expandPlacementRow(row)
  cells[file] = piece.color === 'w' ? piece.type.toUpperCase() : piece.type
  rows[rowIndex] = compressPlacementRow(cells)

  fields[0] = rows.join('/')
  if (clearEnPassant) {
    fields[3] = '-'
  }

  return fields.join(' ')
}

export class PositionTracker {
  private readonly counts = new Map<string, number>()

  constructor(initialFen?: string) {
    if (initialFen !== undefined) {
      this.record(initialFen)
    }
  }

  record(fen: string): number {
    const key = positionKey(fen)
    const count = (this.counts.get(key) ?? 0) + 1
    this.counts.set(key, count)
    return count
  }

  count(fen: string): number {
    return this.counts.get(positionKey(fen)) ?? 0
  }
}
