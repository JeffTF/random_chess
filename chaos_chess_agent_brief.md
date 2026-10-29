# Chaos Chess --- AI Coding Agent Brief

## 1. Project goal

Build a browser-based 1v1 chess variant tentatively called **Chaos
Chess**.

Core mechanics: - Both players start with 100 HP. - A player's exact HP
is hidden from their opponent. - After each legal move, the moved
non-king piece changes into a different piece type. - Random events
appear during the match. Accepting an event may cost HP and apply a
special effect. - A player loses when HP reaches 0. Standard chess
checkmate and draw rules also apply.

Build a shareable browser game. Do not use Unity for this version.

## 2. Recommended technology stack

-   **TypeScript**
-   **React + Vite** for the browser UI
-   **chess.js** for standard legal moves, check, checkmate, castling,
    en passant, promotion, and draw detection
-   **Firebase Authentication** for player identity; anonymous sign-in
    is acceptable for the MVP
-   **Cloud Firestore** for rooms, public match state, move history, and
    realtime updates
-   **Firebase Cloud Functions (TypeScript)** for trusted move
    validation, random outcomes, HP changes, and event resolution
-   **Firebase Hosting** for deployment
-   **Vitest** for unit tests
-   **Firebase Emulator Suite** for local integration tests

Use the Firebase Web SDK in the browser. Never place Admin SDK
credentials or secrets in frontend code.

### Architecture principle

The client submits an *intent* (move, accept/decline event, or piece
selection). Trusted server-side code validates the request and
calculates the result. Clients must not be able to choose their own HP,
transformations, random outcomes, or authoritative board state.

Chess is turn-based, so Firestore realtime updates are suitable for the
MVP; a dedicated realtime game server is not necessary initially.

## 3. Default match rules

Keep rules and tuning values in a central configuration module.

### Match setup

-   Two players join a private room using a room code or invite link.
-   One controls White and one controls Black; White moves first.
-   Both players start at 100 HP.
-   Show a player's own HP, but never show the opponent's exact HP in
    the UI, public documents, errors, or client logs.
-   A player loses if HP reaches 0. Checkmate also ends the game.
    Standard draw conditions apply.
-   Disconnecting does not automatically forfeit the match; allow
    reconnecting.

### Standard chess

Use `chess.js`; do not hand-write movement validation. Standard chess
move legality applies before post-move effects.

### Transform after every move

1.  Validate and apply the legal move.
2.  Resolve standard pawn promotion if applicable.
3.  Transform the moved non-king piece into a different piece type.
4.  Kings never transform.
5.  The transformed type must differ from the piece's current type.
6.  Default: server-side randomness chooses from pawn, knight, bishop,
    rook, and queen, excluding the current type.
7.  Never create a pawn on its promotion rank. Handle this edge case
    explicitly.
8.  Recalculate check, checkmate, legal moves, and draw status after
    transformation.
9.  The server chooses the result and publishes it; clients must not
    randomize independently.

Keep this logic isolated and well tested. If the chess library cannot
safely represent a transformed position, handle the case explicitly
rather than storing invalid state.

### Event scheduling

-   Events appear at random points, not after every move.
-   Initial tuning: after each eligible ply, 25% chance to offer an
    event, with at least 2 plies between offers.
-   Only one event offer can be active at once.
-   Offer response timeout: 15 seconds. Decline or timeout discards the
    offer.
-   For events requiring both players' decisions, collect decisions
    privately and resolve on the server after both respond or the
    timeout.
-   Keep probability, minimum gap, and timeout configurable.

### HP rules

-   Accepting an event deducts its listed cost from the accepting
    player.
-   Declining has no cost.
-   A player cannot accept an event they cannot afford.
-   If an event cost reduces HP to 0, that player loses immediately and
    the event effect does not activate.
-   Clamp HP to 0--100 unless a specific event explicitly changes it.
-   Apply cost and effect atomically on the server.

## 4. Event catalogue

Implement each event as an isolated, testable handler. Put names,
descriptions, costs, eligibility, and effects in a central catalogue.

### A. Hijack the Next Move

-   Cost: 5 HP to the accepting player.
-   Effect: when the opponent next makes a legal move, the piece they
    moved changes ownership to the accepting player at the end of that
    move.
-   The piece stays on its destination square and retains its type.
-   Consume the effect after the opponent's next successful move.

### B. Triple Bomb

-   Cost: 5 HP to the player planting bombs.
-   Mark up to three distinct eligible opponent pieces as bombed.
-   If the opponent moves a bombed piece within their next two turns,
    the bomb triggers and deals 10 HP damage to the opponent who moved
    it.
-   Remove a bomb when it triggers, expires, or its piece is captured
    without moving.
-   If fewer than three eligible enemy pieces exist, bomb all eligible
    pieces.
-   The bomb owner does not take the trigger damage.
-   Show bomb markers on the board, never hidden HP.

### C. Shared HP Loss

-   Cost: 0 HP.
-   Both players lose a random amount of HP, independently rolled from
    5--15 by trusted server logic.
-   HP cannot go below 0; reaching 0 ends the match for that player.
-   Do not disclose the opponent's exact HP.

### D. Protect a Piece

-   Cost: 20 HP.
-   Choose one of the accepting player's non-king pieces and give it a
    one-use shield.
-   The next time it would be captured, prevent the capture and consume
    the shield.
-   The attempted capture is cancelled; the capturing player must make
    another legal move. Do not silently substitute a different move.
-   A piece already shielded cannot be selected again.
-   Display a clear shield marker.

### E. Reverse the Last Move

-   Cost: 20 HP.
-   The accepting player may reverse the immediately preceding move once
    per match.
-   Restore the complete prior chess state, including castling rights,
    en passant, counters, and transformation result.
-   Do not roll back HP costs or already-resolved event effects.
-   Only offer this event when the last move can safely be reverted
    without undoing another resolved event.
-   Track one-time use server-side.
-   Return the turn to the player who made the reversed move.
-   Never restore a finished match or reverse a move after a player has
    already lost.

### F. Swap HP

-   Cost: 50 HP.
-   Deduct the cost first, then exchange both players' resulting HP
    values.
-   If the accepting player cannot pay, reject the acceptance.
-   Check for loss after the cost and after the swap.
-   Make the cost-before-swap order clear in the event description.

### G. Swap Sides

-   Cost: 50 HP.
-   Deduct the cost first. If the accepting player reaches 0 HP, they
    lose and the effect does not activate.
-   Players exchange control of White and Black; board pieces do not
    change color or position.
-   Preserve the current board and turn state, and ensure the player
    assigned to the side whose turn it is can move next.

### H. Friendly Bomb

-   Cost: 5 HP.
-   Choose one of the accepting player's own non-king pieces and attach
    a friendly bomb.
-   If the opponent captures that piece, the opponent loses 10 HP.
-   The bomb remains attached if the piece transforms into a different
    type.
-   Consume the bomb when it triggers; remove it if its piece leaves the
    board for another reason.
-   Kings cannot be bombed.

## 5. Event and move resolution order

Implement and test one documented server-side sequence. Suggested order:

1.  Authenticate caller and verify match membership/status.
2.  Validate turn, request ID, state version, and legal move.
3.  Apply the legal move and promotion.
4.  Apply the transformation.
5.  Resolve move-triggered effects (bombs and hijack).
6.  Update turn and move counters.
7.  Recalculate check, checkmate, and draw status.
8.  Evaluate HP loss and match completion.
9.  Persist the complete new state atomically and return only authorized
    data.

Events that end the match prevent further moves. If two terminal
conditions occur simultaneously, define a deterministic precedence and
cover it with tests. Do not silently improvise rule interactions.

## 6. Firestore data model

Separate public match state from private player state. Never store both
players' private HP in a document readable by both clients.

### `matches/{matchId}` --- public state

-   `status`: `waiting | active | event_pending | finished`
-   `createdAt`, `updatedAt`
-   `playerWhiteUid`, `playerBlackUid`
-   `currentTurn`: `white | black`
-   `fen` or another validated representation of the authoritative board
-   `plyCount`, `version`
-   sanitized move history or a reference to a move subcollection
-   public event metadata (never private choices or HP)
-   board effect markers (bombs and shields)
-   `winnerUid`, `endReason` when finished

### `matches/{matchId}/private/{uid}` --- owner-only state

-   `hp`
-   private decision for the current event
-   whether the player has used Reverse the Last Move
-   other player-specific hidden event data

### `matches/{matchId}/moves/{moveId}` --- move history

-   unique `requestId`
-   `playerUid`
-   `from`, `to`, optional promotion choice
-   piece before/after and transformation result
-   timestamp and resulting state version

Use Security Rules to deny direct client writes to authoritative state
and private HP. Restrict each private document to its owner; Cloud
Functions use the Admin SDK for validated writes.

## 7. Suggested Cloud Functions

Implement authenticated callable or HTTPS functions:

-   `createMatch()`
-   `joinMatch(roomCode)`
-   `submitMove(matchId, requestId, from, to, promotion?)`
-   `respondToEvent(matchId, eventId, accept)`
-   `selectEventPiece(matchId, eventId, square)`
-   `getMyPrivateMatchState(matchId)`

For every request, authenticate the caller, verify membership and turn
where applicable, validate all inputs, prevent duplicate request IDs,
verify the expected version, and apply changes atomically. Never trust
client-provided HP, random values, board state, or event outcomes.

Use server-side randomness for transformations, HP rolls, bomb targets,
and event scheduling. Ensure network retries cannot apply the same move
or cost twice.

## 8. Frontend screens

### Lobby

-   Create match
-   Join by room code
-   Copy invite link
-   Connection and loading status

### Game screen

-   Responsive chessboard
-   Legal move selection and last-move highlight
-   Own HP shown; opponent HP hidden
-   Current turn and check/checkmate status
-   Bomb and shield markers
-   Move history
-   Event modal with description, HP cost, Accept and Decline
-   Clear pending, loading, and error states
-   Reconnect support

### End screen

-   Winner and reason
-   Final board and move history
-   Rematch
-   Return to lobby

Keep the interface clear on desktop and mobile. Do not let animations
block input or obscure whether a move was accepted.

## 9. Security and fairness requirements

-   Admin credentials and secrets must stay server-side.
-   Client cannot directly write authoritative board state, HP,
    transformations, random results, or event effects.
-   Protect private documents with Firestore Security Rules.
-   Validate membership, turn order, event eligibility, and room joins.
-   Prevent concurrent moves using a transaction or version-checked
    atomic update.
-   Add Firebase App Check where practical.
-   Rate-limit or constrain repeated requests.
-   Do not leak opponent HP in snapshots, error messages, analytics, or
    logs.
-   Use Firebase Emulator Suite for development and tests.

## 10. Development phases

### Phase 1 --- Local prototype

-   Set up React/Vite and chess.js.
-   Implement legal chess, check, checkmate, and draws.
-   Transform the moved non-king piece after each move.
-   Test promotion and unusual transformed positions.
-   Do not add Firebase yet.

### Phase 2 --- Online matches

-   Add anonymous authentication.
-   Create/join rooms and assign colors.
-   Add server-authoritative move submission and realtime board updates.
-   Add reconnect and duplicate-request protection.

### Phase 3 --- HP and privacy

-   Add 100 HP per player and HP loss conditions.
-   Hide opponent HP using separate private documents and Security
    Rules.

### Phase 4 --- Event framework

-   Add random scheduling, event offers, timeout, accept/decline, and
    atomic resolution.
-   Use injectable randomness in tests so event tests are deterministic.

### Phase 5 --- Events, one at a time

Recommended order: 1. Shared HP Loss 2. Protect a Piece 3. Friendly Bomb
4. Triple Bomb 5. Hijack the Next Move 6. Swap Sides 7. Swap HP 8.
Reverse the Last Move

Add unit and integration tests for each event before moving to the next.

### Phase 6 --- Polish and deploy

-   Responsive layout and accessibility
-   Reconnect and failure handling
-   Emulator integration tests
-   Firebase Hosting and Cloud Functions deployment

## 11. Acceptance criteria

The MVP is complete when: - Two browsers can join the same match. - Both
clients receive the same authoritative board and move history. - The
server rejects illegal moves. - Each successful non-king move causes
exactly one valid transformation. - Kings never transform. - Check,
checkmate, and draws are recalculated after transformations. - Each
player can see their own HP but cannot read the opponent's HP. - Event
costs and effects apply exactly once. - Duplicate requests cannot repeat
moves or costs. - All implemented events follow their written rules. -
HP reaching 0 ends the match and prevents further moves. - A
disconnected player can reconnect. - The game is deployed at a shareable
browser URL.

## 12. Instructions to the coding agent

1.  Inspect the repository before editing.
2.  Report the current project structure and reusable code.
3.  Present a short plan and assumptions before coding.
4.  Implement one phase at a time and keep the app runnable.
5.  Separate chess rules, event rules, Firebase access, and UI modules.
6.  Write rule tests before complex UI.
7.  Do not fake multiplayer with local state or client-only
    authoritative writes.
8.  Avoid adding unrequested frameworks or services.
9.  Document Firebase setup, environment configuration, emulator use,
    deployment, and required indexes.
10. Report test results honestly; do not claim untested features work.

**First task: implement Phase 1 only.** Deliver a playable local
prototype with legal chess moves and post-move transformation. Do not
configure Firebase or implement events until the chess core and tests
work.
