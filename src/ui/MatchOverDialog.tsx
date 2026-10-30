interface MatchOverDialogProps {
  headline: string
  detail: string
  tone: 'win' | 'lose' | 'draw'
  onExit: () => void
  onViewBoard: () => void
}

export function MatchOverDialog({
  headline,
  detail,
  tone,
  onExit,
  onViewBoard,
}: MatchOverDialogProps) {
  return (
    <div className="modal-backdrop">
      <div
        className={`match-dialog match-dialog-${tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="match-over-title"
      >
        <p className="note-label">Match over</p>
        <h2 id="match-over-title">{headline}</h2>
        <p className="dialog-copy">{detail}</p>
        <div className="match-dialog-actions">
          <button
            type="button"
            className="primary-button"
            onClick={onExit}
          >
            Back to lobby
          </button>
          <button
            type="button"
            className="text-button"
            onClick={onViewBoard}
          >
            View final board
          </button>
        </div>
      </div>
    </div>
  )
}
