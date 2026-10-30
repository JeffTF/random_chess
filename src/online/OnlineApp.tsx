import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createMatch, joinMatch, OnlineError, prewarmSubmitMove, resignMatch } from './api'
import { OnlineGame } from './OnlineGame'
import { useAnonymousUser } from './useAnonymousUser'
import { useMatch } from './useMatch'

function readRoomParam(): string | null {
  const value = new URLSearchParams(window.location.search).get('room')
  return value ? value.trim().toUpperCase() : null
}

function writeRoomParam(roomCode: string | null) {
  const url = new URL(window.location.href)
  if (roomCode) {
    url.searchParams.set('room', roomCode)
  } else {
    url.searchParams.delete('room')
  }
  window.history.replaceState({}, '', url)
}

function messageFor(error: unknown): string {
  if (error instanceof OnlineError) {
    return error.message
  }
  return 'Something went wrong. Please try again.'
}

function inviteLink(roomCode: string): string {
  const url = new URL(window.location.href)
  url.search = ''
  url.searchParams.set('room', roomCode)
  return url.toString()
}

export function OnlineApp({
  onPlayLocal,
  onShowEvents,
}: {
  onPlayLocal: () => void
  onShowEvents: () => void
}) {
  const user = useAnonymousUser()
  const [matchId, setMatchId] = useState<string | null>(null)
  const [roomCode, setRoomCode] = useState<string | null>(readRoomParam)
  const [codeInput, setCodeInput] = useState(readRoomParam() ?? '')
  const [busy, setBusy] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const autoJoinRef = useRef(false)
  const matchState = useMatch(matchId)

  useEffect(() => {
    if (
      user.status !== 'ready' ||
      matchId !== null ||
      roomCode === null ||
      autoJoinRef.current
    ) {
      return
    }
    autoJoinRef.current = true
    void joinByCode(roomCode)
  }, [user.status, matchId, roomCode])

  async function joinByCode(code: string) {
    setBusy(true)
    setError(null)
    try {
      const result = await joinMatch(code)
      writeRoomParam(code)
      setRoomCode(code)
      setMatchId(result.matchId)
    } catch (caught) {
      setError(messageFor(caught))
      writeRoomParam(null)
      setRoomCode(null)
    } finally {
      setBusy(false)
    }
  }

  async function handleCreate() {
    setBusy(true)
    setError(null)
    try {
      const result = await createMatch()
      writeRoomParam(result.roomCode)
      setRoomCode(result.roomCode)
      setMatchId(result.matchId)
    } catch (caught) {
      setError(messageFor(caught))
    } finally {
      setBusy(false)
    }
  }

  function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const code = codeInput.trim().toUpperCase()
    if (code.length !== 6) {
      setError('Room codes are six characters.')
      return
    }
    void joinByCode(code)
  }

  const match = matchState.match
  const warmedRef = useRef<string | null>(null)

  // Run the move function once per room so its cold start does not land on
  // the first real move. Best effort; failures are ignored.
  useEffect(() => {
    if (!matchId || !match) {
      return
    }
    if (match.status !== 'waiting' && match.status !== 'active') {
      return
    }
    if (warmedRef.current === matchId) {
      return
    }
    warmedRef.current = matchId
    void prewarmSubmitMove(matchId).catch(() => {})
  }, [matchId, match])

  async function handleLeave() {
    if (!matchId || !match || match.status === 'waiting') {
      backToLobby()
      return
    }
    if (match.status === 'finished') {
      backToLobby()
      return
    }
    const confirmed = window.confirm(
      'Leaving an active match counts as a resignation. Your opponent wins. Leave?',
    )
    if (!confirmed) {
      return
    }
    setLeaving(true)
    setError(null)
    try {
      await resignMatch(matchId)
    } catch (caught) {
      setError(messageFor(caught))
      setLeaving(false)
      return
    }
    backToLobby()
  }

  function backToLobby() {
    writeRoomParam(null)
    setMatchId(null)
    setRoomCode(null)
    setError(null)
    setBusy(false)
    setLeaving(false)
    setCopied(false)
    autoJoinRef.current = true
  }

  async function copyInvite(code: string) {
    try {
      await navigator.clipboard.writeText(inviteLink(code))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy the link. Select it above and copy manually.')
    }
  }

  return (
    <div className="app">
      <header className="masthead">
        <div className="brand">
          <p className="eyebrow">
            <span className="eyebrow-mark" aria-hidden="true" />
            {match
              ? `Online match · Room ${match.roomCode}`
              : 'Online rooms'}
          </p>
          <h1>Chaos Chess</h1>
          <p className="tagline">
            Every non-king move rewrites the piece that made it.
          </p>
        </div>
        <div className="masthead-actions">
          <button
            type="button"
            className="new-game-button"
            onClick={onShowEvents}
          >
            All events
          </button>
          <button
            type="button"
            className="new-game-button"
            onClick={match ? () => void handleLeave() : onPlayLocal}
            disabled={leaving}
          >
            {match ? (leaving ? 'Leaving…' : 'Leave match') : 'Local practice'}
          </button>
        </div>
      </header>

      {user.status === 'loading' && (
        <section className="panel lobby-panel" aria-live="polite">
          <p className="note-label">Connecting</p>
          <h2>Signing in…</h2>
          <p className="online-note">
            Anonymous sign-in keeps your seat across refreshes.
          </p>
        </section>
      )}

      {user.status === 'error' && (
        <section className="error-banner" role="alert">
          {user.message}
        </section>
      )}

      {user.status === 'ready' && !matchId && (
        <main className="lobby">
          <section className="panel lobby-panel">
            <p className="note-label">Start a match</p>
            <h2>Create a private room</h2>
            <p className="online-note">
              You play White. Share the code or invite link with one opponent.
            </p>
            <button
              type="button"
              className="primary-button"
              onClick={() => void handleCreate()}
              disabled={busy}
            >
              {busy ? 'Creating…' : 'Create match'}
            </button>
          </section>

          <section className="panel lobby-panel">
            <p className="note-label">Join a match</p>
            <h2>Enter a room code</h2>
            <form className="join-form" onSubmit={handleJoin}>
              <input
                className="code-input"
                value={codeInput}
                onChange={(event) =>
                  setCodeInput(
                    event.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, '')
                      .slice(0, 6),
                  )
                }
                placeholder="ABC234"
                maxLength={6}
                autoComplete="off"
                spellCheck={false}
                aria-label="Room code"
              />
              <button
                type="submit"
                className="primary-button"
                disabled={busy || codeInput.length !== 6}
              >
                Join
              </button>
            </form>
            <p className="online-note">You play Black in a joined room.</p>
          </section>

          {error && (
            <div className="error-banner lobby-error" role="alert">
              {error}
            </div>
          )}
        </main>
      )}

      {user.status === 'ready' && matchId && matchState.loading && (
        <section className="panel lobby-panel" aria-live="polite">
          <p className="note-label">Room</p>
          <h2>Connecting to the match…</h2>
          <p className="online-note">Listening for the authoritative board.</p>
        </section>
      )}

      {user.status === 'ready' && matchId && matchState.error && (
        <section className="panel lobby-panel">
          <p className="note-label">Connection problem</p>
          <h2>{matchState.error}</h2>
          <button
            type="button"
            className="new-game-button"
            onClick={backToLobby}
          >
            Back to lobby
          </button>
        </section>
      )}

      {user.status === 'ready' && match && match.status === 'waiting' && (
        <section className="panel waiting-panel">
          <p className="note-label">Room ready</p>
          <h2>Waiting for your opponent</h2>
          <div className="room-code" aria-label="Room code">
            {match.roomCode}
          </div>
          <p className="online-note">
            You are playing White. Send this link to your opponent; the board
            starts as soon as they join.
          </p>
          <div className="copy-row">
            <input
              className="link-input"
              readOnly
              value={inviteLink(match.roomCode)}
              aria-label="Invite link"
              onFocus={(event) => event.currentTarget.select()}
            />
            <button
              type="button"
              className="new-game-button"
              onClick={() => void copyInvite(match.roomCode)}
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          <button type="button" className="text-button" onClick={backToLobby}>
            Leave match
          </button>
        </section>
      )}

      {user.status === 'ready' && matchId && match && match.status !== 'waiting' && error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      {user.status === 'ready' && matchId && match && match.status !== 'waiting' && (
        <OnlineGame
          matchId={matchId}
          match={match}
          uid={user.uid}
          onExit={backToLobby}
          onLeave={() => void handleLeave()}
          leaving={leaving}
        />
      )}
    </div>
  )
}
