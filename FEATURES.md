# Chaos Chess — Feature Inventory and Remaining Work

Status date: 2026-10-29

Implemented and verified through **Phase 5**. All verification is against the
local Firebase Emulator Suite (and manual browser play); nothing has been
deployed to the live Firebase project yet.

## Status at a glance

| Area | State |
| --- | --- |
| Chess engine + post-move transformation | Done |
| Local hotseat practice mode | Done |
| Anonymous auth, rooms, invite links, reconnect | Done |
| Server-authoritative moves, versioning, idempotency | Done |
| Private HP (100/player, opponent hidden) | Done (Phase 3) |
| Event scheduling, offers, timeout, atomic resolution | Done |
| All eight chaos events | Done |
| Emulator integration tests | Done (Phases 2, 3, 4–5) |
| Production deployment (Hosting + Functions + rules) | **Not done** |
| App Check, rate limiting, rematch, spectators | **Not done** |

## Architecture and trust model

- React 19 + Vite + TypeScript, chess.js 1.4 for all chess legality.
- Cloud Functions v2 callables own the board: clients submit intents only.
- Firestore stores public match state; per-player HP lives in owner-only
  documents. All authoritative writes happen with the Admin SDK.
- Randomness (transformations, event scheduling, damage rolls, bomb targets)
  is server-side and injectable in tests.
- Shared rule code lives in `src/game/` and is imported by both the browser
  and the functions bundle.

## Implemented features

### 1. Core chess and transformation rules

- Full standard chess via chess.js: legal moves, castling, en passant,
  promotion, check, checkmate, stalemate, insufficient material, fifty-move
  draw, threefold repetition.
- Every successful **non-king** move transforms the moved piece into a
  different type (pawn, knight, bishop, rook, queen; never the same type).
- Kings never transform.
- A transformed pawn is never placed on rank 1 or 8.
- Promotion is resolved before the transformation.
- The transformed position is rebuilt and re-validated; an unrepresentable
  result is rejected instead of storing invalid state.
- Check, checkmate, legal moves, and draw status are recalculated after the
  transformation.
- En passant rights are cleared when a transformation invalidates them.
- Move history stores SAN, from/to, captured piece, promotion, transformation,
  and the resulting FEN.
- Config: `src/game/config.ts` (`GAME_CONFIG`), transformation candidates and
  forbidden pawn ranks.

### 2. Local hotseat practice

- Playable at `/?local=1` (or via the **Local practice** button).
- Click-to-select, legal-move highlighting, last-move highlight, promotion
  dialog, move history, and transformation summary.
- New game reset. Not connected to Firebase.
- Deliberately chess + transformations only: no HP or random events in local
  mode.

### 3. Online matches

- Anonymous Firebase sign-in that survives refreshes.
- **Create match** → six-character room code and shareable invite link.
- **Join match** by code; invite links auto-join through `?room=CODE`.
- Waiting screen with room code, copy-link, and leave.
- Reconnect: reopening the link signs back in anonymously, and `joinMatch` is
  idempotent for existing members.
- Realtime board via Firestore snapshot listener; both clients see the same
  authoritative state.
- `submitMove` validates in a transaction:
  - authentication and membership,
  - whose turn it is,
  - `requestId` idempotency (a retry never applies the move twice),
  - `expectedVersion` stale-state rejection,
  - server-side legal-move and transformation checks.
- Moves are written to `matches/{matchId}/moves/{requestId}` with the request,
  player, pieces before/after, transformation, effects, and resulting version.
- Non-members cannot read the match, read private state, or call member-only
  functions (verified by emulator tests).

### 4. HP and privacy (Phase 3)

- Both players start at 100 HP; HP is clamped to 0–100.
- HP lives in `matches/{matchId}/private/{uid}`; only the owner can read it.
- `getMyPrivateMatchState` returns the caller's own HP.
- The public match document, move documents, event documents, and event offers
  never contain HP.
- The UI shows your own HP and a hidden opponent placeholder; the opponent's
  exact value is never sent to your client.
- HP depletion ends the match with `endReason: 'hp-depleted'` and blocks
  further moves.
- Terminal precedence is deterministic: effects resolve first, then HP
  depletion is checked against the resolved chess position and takes
  precedence over a simultaneous checkmate or draw; 0 HP on both sides is a
  draw.

### 5. Event framework (Phase 4)

- After a successful move, the server may offer one event to the player who
  just moved.
- Default tuning: **25%** chance per eligible ply, **at least 2 plies** between
  offers, **15-second** response window, at most one active offer.
- Only eligible events are offered (e.g. Reverse requires a safe last move;
  piece-target events require eligible pieces; hijack cannot stack).
- The offer is published on the match document (`event`) and in
  `matches/{matchId}/events/{eventId}`; players can read event records,
  clients cannot write them.
- `respondToEvent(matchId, eventId, accept, square?)` accepts or declines.
  The server re-reads the cost from the shared catalogue and never trusts the
  stored offer or any client HP value.
- Offer expiry is settled lazily: either client may settle it after the
  deadline, and `submitMove` settles an expired offer inline, so a walk-away
  never stalls the match.
- Accepted, declined, and expired outcomes are recorded in `lastEvent` and on
  the event document.
- Cost and effect are applied in the same Firestore transaction as the HP
  debit. Repeating the same answer is idempotent (no double charge).
- Accepting a cost that would leave 0 HP ends the match and the effect does
  not activate.
- Moves are frozen for both players while an offer is pending.

### 6. The eight events (Phase 5)

| Event | Cost | Effect |
| --- | --- | --- |
| Shared HP Loss | 50 | Both players lose 5–15 HP, rolled independently; only the caller's own loss is returned. |
| Protect a Piece | 20 | Shield one of your non-king pieces; the next capture against it is cancelled, the shield is consumed, and the attacker must choose another move. |
| Friendly Bomb | 5 | Bomb one of your non-king pieces; if the opponent captures it, the captor loses 10 HP. Travels with the piece through transformations. |
| Triple Bomb | 5 | Server marks up to three opponent pieces; moving one within the next two target-side moves deals 10 HP to the mover. |
| Hijack the Next Move | 5 | The opponent's next moved non-king piece switches ownership at its destination and keeps its type; the hijack is consumed by that move. |
| Swap Sides | 50 | Pay the cost, then exchange White/Black control; pieces and the current turn stay put, so the newly assigned player can move. |
| Swap HP | 50 | Pay the cost first, then exchange both players' remaining HP; loss is checked after cost and after swap. |
| Reverse the Last Move | 20 | Undo the previous move once per player, restoring the prior FEN, castling/en-passant rights, counters, and turn. HP costs and resolved effects are not rolled back. Only offered when no markers exist and the last move had no effects. |

Detailed server rules live in `functions/src/eventRules.ts`, the shared
catalogue in `src/game/events.ts`, and movement-triggered effects in
`functions/src/matchRules.ts`.

### 7. Move/effect resolution order

Documented and unit tested:

1. Authenticate and verify membership, turn, request ID, and version.
2. Validate the move.
3. Apply the move and promotion.
4. Apply the transformation.
5. Resolve move-triggered effects in this order:
   - shield block (cancels the capture and spends the shield),
   - carried triple bomb,
   - bomb on the captured piece,
   - hijack transfer,
   - triple-bomb expiry.
6. Update markers (shields and friendly bombs travel with the moved piece).
7. Evaluate HP depletion and chess endings, with HP depletion taking
   precedence; both players at 0 HP is a draw.
8. Persist the complete state atomically and return only authorized data.

Hijack has a soundness guard: if the ownership switch would leave the former
owner's king attacked (an unrepresentable position), the hijack is consumed
without changing the piece.

### 8. UI features

- Responsive two-column layout with mobile breakpoints and reduced-motion
  support.
- Chessboard with legal-move dots, capturable highlights, last-move highlight,
  check styling, and ARIA labels for pieces and markers.
- HP panel (own value, hidden opponent), effects panel (bomb/shield rows with
  sides, hijack state, latest event summary), move history, transformation
  summary.
- Event dialog with name, description, cost, live countdown, Accept/Decline,
  piece picker for target events (own non-king pieces, excluding already
  shielded/bombed), disabled Accept when unaffordable or incomplete, and a
  warning when the cost would drop HP to 0.
- Board markers: shield ring, friendly bomb, triple bomb with remaining-move
  count.
- Status/notice banners for opponent-deciding, expired offers, blocked
  captures, and event outcomes.
- End banner with winner/reason (you win, you lose, draw) and back to lobby.
- Lobby with create, join, invite-link copy, connection/loading/error states.

### 9. Data model

- `matches/{matchId}` — status (`waiting | active | event_pending | finished`),
  players, turn, FEN, start FEN, ply count, version, history, last move,
  winner/end reason, current offer, board effects, last event, timestamps.
- `matches/{matchId}/private/{uid}` — `hp`, `reverseUsed`; owner-only reads,
  no client writes.
- `matches/{matchId}/moves/{requestId}` — idempotent move records.
- `matches/{matchId}/events/{eventId}` — public event status and timing.
- Security rules: match and event records readable by players; private
  documents owner-only; every client write denied.
- No composite Firestore indexes are required (room lookup uses one equality
  filter).

### 10. Cloud Functions

- `createMatch`, `joinMatch`, `submitMove`, `respondToEvent`,
  `getMyPrivateMatchState` (region `asia-southeast1` by default).
- Every callable authenticates, validates payload types/patterns, checks
  membership and state, and applies changes in a transaction.
- Stable error reasons (`not-a-member`, `wrong-turn`, `stale-version`,
  `invalid-move`, `event-pending`, `event-not-pending`, `not-event-target`,
  `cannot-afford`, `invalid-selection`) without leaking HP.

### 11. Configuration and local setup

- `.env.example` documents the Firebase web config, region, and emulator
  switch.
- `npm run emulators` builds functions and starts Auth 9099, Firestore 8080,
  Functions 5001, UI 4000.
- `npm run dev` uses emulators by default.
- Event tuning overrides for local testing: `CHAOS_EVENT_CHANCE`,
  `CHAOS_EVENT_MIN_GAP_PLIES`, `CHAOS_EVENT_TIMEOUT_MS`.
- `CHAOS_FUNCTIONS_REGION` overrides the deployed functions region.
- README documents Firebase setup, emulator use, checks, deployment, and the
  data model.

### 12. Testing and verification

Automated:

- `npm test` — **72 unit tests** across 6 files: chess/transformation,
  FEN handling, restore, random, HP, server move rules (17), event rules (18),
  and scheduling/resolution of all eight events.
- `npm run typecheck`, `npm run typecheck:functions`, `npm run build` — pass
  (build warns only about the >500 kB bundle chunk).
- `npm run test:emulator` — three scripts against the live emulator suite:
  - `phase2-check.mjs`: multi-player sync, turn/illegal/non-member rejection,
    duplicate `requestId`, stale-version rejection, rules for non-members.
  - `phase3-check.mjs`: private HP, owner-only access, no HP in public state.
  - `phase4-check.mjs`: friendly-bomb damage, shield block, protect-piece
    permissions/cost/idempotency, offer expiry, no HP in event or public data.
  All pass.

Manual browser verification (emulator):

- Offer appeared after a natural move, countdown ran, Reverse was accepted
  (HP deducted, board restored, move list reset), Hijack was accepted and
  transferred a real Black move, a Black offer was auto-settled by the White
  client after 15 seconds, piece picker/shield accept worked, shield/friendly/
  triple bomb markers and the effects panel rendered, an attempted capture of
  a shielded pawn returned the blocked notice, and an explicit decline
  resumed play with no cost.
- Some UI states (piece picker, bomb markers, blocked capture, decline) were
  staged with Admin-SDK-seeded match documents; every event's server logic is
  covered by unit and emulator tests.

## What is left to do

### Phase 6 — required for the MVP acceptance criteria

1. **Deploy to the real Firebase project** (`random-chess-4a16d`,
   `asia-southeast1`): Blaze plan, anonymous auth enabled, Firestore created,
   `firebase login`, then
   `npx firebase deploy --only firestore:rules,functions,hosting`.
   The shareable production URL and production end-to-end check are still
   outstanding.
2. **Production smoke test**: two browsers join the deployed URL, play a
   move, accept an event, refresh/reconnect, and confirm the game finishes
   correctly.

### Security and robustness

3. **Firebase App Check** (brief asks for it “where practical”): register the
   web app and enforce App Check on callables.
4. **Rate limiting / abuse controls** for match creation and callable traffic
   (e.g. per-UID quotas) — not implemented.
5. **Client error observability** without HP leakage (structured logging on
   the server, no private values in messages) — currently only generic
   console errors.

### Missing product features

6. **Rematch**: no rematch flow; the end screen only offers back-to-lobby.
   The brief lists rematch on the end screen.
7. **Presence / forfeit**: disconnecting does not forfeit (intentional), but
   there is no presence indicator and no resign/forfeit action. `resignation`
   exists as an `EndReason` but no callable or UI uses it.
8. **Spectator views**: not implemented; matches are two-player only.
9. **Full event history UI**: only the latest event is shown; event documents
   exist but there is no match-wide event log.
10. **Two-sided event decisions**: the brief mentions collecting private
    decisions from both players for events that need both; none of the eight
    events need it, so the framework only supports a single responder.
11. **Separate `selectEventPiece` callable**: the brief suggested one; the
    piece choice is instead part of `respondToEvent` (atomic, already tested).
    This is a deliberate simplification, not a gap unless the API shape matters.

### Polish and quality

12. **Code-split the production bundle** (Vite warns the main chunk is about
    847 kB / 258 kB gzipped); dynamic-import the online screen or split the
    Firebase SDK.
13. **Accessibility audit**: focus-visible styles, dialog roles, ARIA labels,
    and live regions exist, but there has been no formal screen-reader or
    keyboard-only pass.
14. **Mobile device pass**: responsive breakpoints exist but verification was
    desktop-browser only.
15. **Stale copy**: the local hotseat note still says random events are “for a
    later phase”; update it to say HP/events are online-only.
16. **CI**: no automated pipeline runs unit, typecheck, and emulator checks on
    push.
17. **Debug logs in the repo**: `firebase-debug.log` and `firestore-debug.log`
    are tracked and modified by emulator runs; consider ignoring them.

### Intentionally out of scope

- Matchmaking, accounts/profiles, chat, leaderboards, and persistent stats
  were not requested.
- Local hotseat remains HP-free and event-free by design; online mode is the
  full ruleset.
