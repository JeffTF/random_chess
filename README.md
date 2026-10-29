# Chaos Chess

Browser chess variant: every non-king move transforms the piece that made
it. Phase 1 (local rules) and Phase 2 (online rooms with a
server-authoritative board) are implemented.

## Requirements

- Node.js 22 or newer (developed on Node 26)
- Java 21+ for the Firestore emulator. Android Studio's bundled runtime
  works: point `JAVA_HOME` at
  `C:\Program Files\Android\Android Studio\jbr`.
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

## Checks

```powershell
npm test                  # chess, restore, and server-rule unit tests
npm run typecheck
npm run typecheck:functions
npm run build
npm run test:emulator     # needs the emulators running
```

`test:emulator` signs in three anonymous players and verifies:
two-player sync, rejection of out-of-turn/illegal/non-member moves,
duplicate `requestId` idempotency, stale-version rejection, and
Firestore rules for non-members.

## Deploy

```powershell
npx firebase deploy --only firestore:rules,functions,hosting
```

Hosting publishes `dist` after `npm run build`. No composite Firestore
indexes are required yet; room lookup uses a single equality filter.

## Structure

- `src/game/` — pure chess + transformation rules, shared by the browser
  and Cloud Functions.
- `src/online/` — lobby, room session, realtime board, callable clients.
- `src/ui/` — board, move list, promotion dialog, local hotseat screen.
- `functions/src/matchRules.ts` — validates and applies a move on stored
  state; unit tested with injected randomness.
- `functions/src/index.ts` — `createMatch`, `joinMatch`, `submitMove`.
- `firestore.rules` — players may read their match; all client writes are
  denied. `matches/{id}/private/{uid}` is reserved for Phase 3 HP.

## Not implemented yet

HP, random events, App Check, request rate limiting, presence/forfeit,
rematch, and spectator views belong to later phases.
