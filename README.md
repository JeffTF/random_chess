# Chaos Chess

Browser chess variant: every non-king move transforms the piece that made
it. Phase 1 (local rules), Phase 2 (online rooms with a
server-authoritative board), Phase 3 (private HP), Phase 4 (random event
framework), and Phase 5 (all eight chaos events) are implemented.

## Requirements

- Node.js 22 or newer (developed on Node 26)
- Java 21+ for the Firestore emulator. Android Studio's bundled runtime
  works: put `C:\Program Files\Android\Android Studio\jbr\bin` first on
  `PATH` (and optionally set `JAVA_HOME` to the same directory). The CLI
  checks the `java` on `PATH`, so `JAVA_HOME` alone is not enough.
- npm

## Install

```powershell
npm install
npm --prefix functions install
```

Create `.env.local` from `.env.example` and fill in the Firebase web app
configuration. These values are public project identifiers, not secrets.

## Firebase project setup (one time)

1. Firebase Console → Authentication → Sign-in method → enable
   **Anonymous**.
2. Firestore Database → create a database in Native mode.
3. To deploy Cloud Functions, the project must be on the **Blaze** plan.
4. Web app settings → copy the config into `.env.local`.
5. `npx firebase login` once, before deploying.

The default functions region is `asia-southeast1`. Keep
`VITE_FIREBASE_REGION` in `.env.local` aligned with it, or override the
server side with the `CHAOS_FUNCTIONS_REGION` environment variable.

## Local development

Terminal 1 — emulators (builds the functions bundle first):

```powershell
npm run emulators
```

Terminal 2 — the app:

```powershell
npm run dev
```

Open http://localhost:5173. Development talks to the Emulator Suite by
default; `npm run dev` never touches the real project unless
`VITE_USE_FIREBASE_EMULATORS=false` is set. Production builds always use
the real project.

The creator plays White. Copy the invite link from the waiting screen and
open it in another browser (or a private window) to join as Black.

If the browser shows "Could not reach Firebase Authentication", the
emulator terminal is not running: dev sign-in goes to
`http://127.0.0.1:9099`, so start `npm run emulators` first, then reload.
If the emulator logs "User code failed to load ... Timeout after 10000",
restart it with a longer budget: `FUNCTIONS_DISCOVERY_TIMEOUT=30`.
Neither problem can be fixed by reloading the page alone.

## Checks

```powershell
npm test                  # chess, restore, HP, event, and server-rule unit tests
npm run typecheck
npm run typecheck:functions
npm run build
npm run test:emulator     # needs the emulators running
```

`test:emulator` runs three scripts:

- `scripts/phase2-check.mjs` — three anonymous players; verifies two-player
  sync, rejection of out-of-turn/illegal/non-member moves, duplicate
  `requestId` idempotency, stale-version rejection, and Firestore rules for
  non-members. Event offers are settled first so the random schedule does
  not make the assertions flaky.
- `scripts/phase3-check.mjs` — verifies each player starts at 100 HP, each
  player can read only their own private HP document, non-members cannot
  read private state or call `getMyPrivateMatchState`, and public match
  state contains no HP.
- `scripts/phase4-check.mjs` — seeds matches with the Admin SDK; verifies a
  friendly bomb damages the capturer, a shield cancels a capture and is
  consumed, `protect-piece` enforces permissions/piece selection/cost and
  is idempotent, offer expiry resumes the match, and event documents and
  public state never contain HP.

## HP and privacy (Phase 3)

- Both players start at 100 HP. The values live in
  `matches/{matchId}/private/{uid}`; the public match document never
  contains HP.
- `firestore.rules` allows a private document to be read only by its owner,
  and only while that user is a player in the match. All client writes are
  denied; Cloud Functions write HP with the Admin SDK.
- `getMyPrivateMatchState(matchId)` returns `{ hp }` for the caller only.
  It rejects non-members with `permission-denied`.
- The game screen shows your own HP and a hidden placeholder for the
  opponent. The opponent's number is never sent to your client.
- HP depletion ends the match with `endReason: 'hp-depleted'`. It is
  evaluated after the chess position, so it takes precedence over a
  simultaneous checkmate; 0 HP on both sides is a draw. The rule lives in
  `functions/src/hp.ts` and is unit tested.
- Event costs and event damage are the HP sources: accepting an offer pays
  its cost, shared HP loss and bombs deal damage, and accepting a cost that
  would leave you at 0 HP ends the match before the effect activates.

## Chaos events (Phases 4–5)

- After a non-king move resolves, the server may offer one event to the
  player who just moved. Defaults: 25% chance, at least 2 plies between
  offers, 15-second response window. At most one offer exists at a time.
- The offer lives on the match document (`event`) and in
  `matches/{matchId}/events/{eventId}` (public, read-only for players).
  Accepting or declining goes through `respondToEvent`; the server re-reads
  costs from the shared catalogue in `src/game/events.ts` rather than
  trusting the stored offer.
- If nobody answers in time, either client settles the expired offer (and
  `submitMove` settles it inline), so the match never stalls. Expired,
  declined, and accepted outcomes are recorded in `lastEvent`.
- Accepting costs HP. If the cost would take you to 0, the match ends with
  `hp-depleted` and the effect does not activate. The accepted effect is
  applied inside the same Firestore transaction as the HP debit.
- Eight events: shared HP loss (50), protect a piece (20), friendly bomb
  (5), triple bomb (5), hijack the next move (5), swap sides (50), swap HP
  (50), reverse the last move (20, once per player). Costs, durations, and
  damage live in `EVENT_TUNING` / `EVENT_CATALOGUE`.
- Move-triggered effects resolve in this order: shield block (cancels the
  move), carried triple bomb, bomb on the captured piece, hijack transfer,
  triple-bomb expiry. Markers travel with transformed pieces.
- Emulator-only tuning overrides for faster manual testing:
  `CHAOS_EVENT_CHANCE` (0–1), `CHAOS_EVENT_MIN_GAP_PLIES` (integer ≥ 0),
  and `CHAOS_EVENT_TIMEOUT_MS` (≥ 1000). Set them before
  `npm run emulators`.
- Privacy: event offers, event documents, and public match state never
  contain HP. Damage rolls are applied with the Admin SDK; only the
  accepting player's own loss is returned by `respondToEvent`.

## Deploy

```powershell
npx firebase deploy --only firestore:rules,functions,hosting
```

Hosting publishes `dist` after `npm run build`. No composite Firestore
indexes are required yet; room lookup uses a single equality filter.

## Structure

- `src/game/` — pure chess + transformation rules, shared by the browser
  and Cloud Functions. Match tuning (including HP) is in `config.ts`; the
  event catalogue and tuning are in `events.ts`.
- `src/online/` — lobby, room session, realtime board, private HP hook,
  event/effect normalisation, callable clients.
- `src/ui/` — board with effect markers, move list, HP panel, promotion
  dialog, event dialog, chaos-effects panel, local hotseat screen.
- `functions/src/hp.ts` — HP clamping and depletion endings.
- `functions/src/matchRules.ts` — validates and applies a move on stored
  state, including move-triggered effects and HP-aware end resolution;
  unit tested with injected randomness.
- `functions/src/eventRules.ts` — event eligibility, offers, expiry, and
  all eight effect resolutions; unit tested with injected randomness.
- `functions/src/index.ts` — `createMatch`, `joinMatch`, `submitMove`,
  `respondToEvent`, `getMyPrivateMatchState`.
- `firestore.rules` — players may read their match and its event records;
  each private document is owner-only; all client writes are denied.

## Not implemented yet

App Check, request rate limiting, presence/forfeit, rematch, and spectator
views belong to later phases.
