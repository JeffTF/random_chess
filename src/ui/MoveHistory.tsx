import type { MoveRecord } from '../game/types'
import { PIECE_GLYPHS, colorName, pieceName } from './pieceDisplay'

interface MoveHistoryProps {
  history: readonly MoveRecord[]
}

function TransformationChip({
  record,
}: {
  record: MoveRecord
}) {
  if (!record.transformation) {
    return (
      <span className="transform-chip transform-none" title="Kings never transform">
        king
      </span>
    )
  }

  const { from, to } = record.transformation

  return (
    <span
      className={`transform-chip transform-${record.color}`}
      aria-label={`${colorName(record.color)} ${pieceName(from)} transformed into a ${pieceName(to)}`}
    >
      <span className="mini-glyph" aria-hidden="true">
        {PIECE_GLYPHS[from]}
      </span>
      <span className="mini-arrow" aria-hidden="true">
        →
      </span>
      <span className="mini-glyph" aria-hidden="true">
        {PIECE_GLYPHS[to]}
      </span>
    </span>
  )
}

function MoveCell({ record }: { record: MoveRecord | undefined }) {
  if (!record) {
    return <span className="move-empty">·</span>
  }

  return (
    <span className={`move-cell move-cell-${record.color}`}>
      <span className="move-san">{record.san}</span>
      <TransformationChip record={record} />
    </span>
  )
}

export function MoveHistory({ history }: MoveHistoryProps) {
  if (history.length === 0) {
    return (
      <div className="empty-history">
        No moves yet. White opens the game.
      </div>
    )
  }

  const rows: Array<{
    number: number
    white: MoveRecord | undefined
    black: MoveRecord | undefined
  }> = []

  for (let index = 0; index < history.length; index += 2) {
    rows.push({
      number: index / 2 + 1,
      white: history[index],
      black: history[index + 1],
    })
  }

  return (
    <div className="move-list" aria-label="Move history">
      {rows.map((row) => (
        <div className="move-row" key={row.number}>
          <span className="move-number">{row.number}.</span>
          <MoveCell record={row.white} />
          <MoveCell record={row.black} />
        </div>
      ))}
    </div>
  )
}
