# Chaos Chess: Move Performance and Latency Improvement Instructions

## Goal

Reduce the time between a player making a move and both boards showing the authoritative result. The reported delay is about 3 seconds. On a normal connection, aim for the opponent to see a committed move within 1 second at the 95th percentile, while the moving player sees an immediate local response.

This document is an implementation brief for a coding agent. **Inspect the existing repository and runtime flow before changing architecture.** Do not assume the current data model, listener setup, function layout, or exact source of the delay. Keep the existing product behavior and Chaos Chess rules intact.

## Presumed architecture and scope

Assume for planning purposes that the game currently uses **Cloud Firestore, Firestore realtime listeners, and Cloud Functions**. Confirm this by inspecting dependencies, Firebase configuration, security rules, deployed function references, and client code.

Recommendations specifically about callable/HTTPS Cloud Functions, function region, Firestore transactions, and Firestore snapshot listeners apply only if this setup is present. If the code uses Realtime Database, direct client writes, another backend, or a mixed design, document the actual flow and adapt equivalent principles rather than migrating databases as part of a latency fix.

Do not make a database migration or broad rewrite without evidence that the measured bottleneck requires it. Preserve server-authoritative move validation and hidden-information rules, including concealed opponent HP.

## Phase 1 — Map and measure the current move path

Before implementation:

1. Trace a move from input to display on both clients: local input/animation and board state update; client request(s), including retries; server validation and game-rule processing; database reads, writes, transactions, and triggers; opponent subscription delivery; client state update, rendering, and animation completion.
2. Identify all code and configuration involved. Note whether moves are written directly by clients, sent through one or more functions, or processed by database triggers.
3. Find all subscriptions to the match and determine when each is created, replaced, and cleaned up. Check component lifecycle code, route changes, reconnect handling, and development Strict Mode behavior.
4. Add temporary or appropriately sampled structured timing instrumentation with a shared moveId/correlation ID. Measure input to optimistic local render; input to request dispatch; request round trip; function start, validation/rule processing, database operation, and completion; commit/write timestamp to opponent listener callback; listener callback to opponent board render; and end-to-end input to opponent-visible result.
5. Record durations with a monotonic client clock. Do not subtract unsynchronized client wall clocks from server wall clocks. Use server timestamps or trace/span timing to estimate cross-system intervals.
6. Record region, network quality when available, cold versus warm function invocation where observable, payload size, document reads/writes, listener count, and retries. Avoid logging secrets or private game state.
7. Establish a baseline from representative sessions and report p50, p95, and p99, sample count, failures/rejections, and test conditions. Separate moving-player responsiveness from opponent propagation latency.

If timing shows the delay is outside the network/backend path (for example, a long animation or blocked main thread), fix that cause instead of applying unrelated backend changes.

## Target latency budgets

Use these initial budgets as measurable goals, not guarantees. Record actual baseline before optimizing.

| Segment | Goal |
|---|---:|
| Local optimistic board response after valid input | ≤100 ms |
| Client-to-authoritative-operation round trip (warm, normal connection) | p95 ≤500 ms |
| Server validation and game-rule processing | p95 ≤150 ms |
| Authoritative database commit | p95 ≤200 ms |
| Commit to opponent listener callback | p95 ≤500 ms |
| Commit to opponent board render, excluding deliberate animation | p95 ≤700 ms |
| Opponent-visible committed move, end to end | p95 ≤1,000 ms |
| Reconciliation after authoritative response | No visible jump when prediction was correct |

Track function cold starts separately; do not hide them in warm-path averages. If real users’ geography or hosting limits make a target impractical, publish the observed distribution and revise the target deliberately.

## Phase 2 — Make the local board responsive

Apply a move immediately to the acting player’s local view after local input checks. This is an optimistic/pending state, not proof that the move is accepted.

- Keep a snapshot or deterministic prior state so the client can restore it if the server rejects the move.
- Clearly track pending move state by moveId; prevent accidental duplicate submissions and define whether the player may queue another move.
- On acceptance, reconcile with the canonical server result, including piece transformations, random events, HP changes, turn, and any other authoritative effects.
- If the canonical result matches the prediction, update metadata without replaying the move or causing a visual jump.
- If the server rejects the move, restore/reload the authoritative state and show a concise explanation. Ensure rollback also clears animations, pending markers, and input locks.
- Random event selection, hidden HP, event outcomes, and all rule decisions must remain server-authoritative. Do not reveal hidden information through optimistic state, error messages, or payload differences.
- Ensure a player cannot exploit local prediction, stale state, browser tools, or offline queued writes to commit an illegal move.

If local move validation is duplicated for responsiveness, treat it as a UX aid only. The server remains the source of truth.

## Phase 3 — Keep opponent state live

**If Firestore is in use**, subscribe to the match document with the Firebase client SDK realtime snapshot listener (onSnapshot) rather than polling or repeatedly fetching the document for every board update.

- Create one active listener per relevant match/client view, scoped to the current match ID.
- Unsubscribe on match change, screen unmount, logout, or other lifecycle exit.
- Avoid attaching listeners from multiple components to the same match unless each has a clear purpose.
- Handle initial snapshots, reconnects, metadata-only updates, permission errors, deleted/missing matches, and stale/out-of-order move versions.
- Apply each accepted authoritative version once. Use a monotonic version/ply or equivalent to ignore stale state; do not rely on client wall-clock ordering.
- If the Firestore SDK local cache or latency compensation can surface local writes, distinguish pending local changes from server-committed state where relevant. Do not mistake the sender local echo for authoritative acceptance.
- Avoid polling in parallel with an active listener unless there is a documented recovery reason.

Equivalent realtime subscription principles apply if the inspected architecture is not Firestore.

## Phase 4 — Consolidate move processing

If inspection confirms multiple client requests, trigger chains, or writes per move, simplify to one authoritative operation where practical.

For a Cloud Functions + Firestore design, the preferred logical flow is:

1. Client sends a compact move intent with matchId, moveId (idempotency key), expected match version, and move coordinates/choice.
2. One trusted callable or HTTPS function authenticates the player and checks membership/turn.
3. The operation validates the expected version and move legality, computes piece transformation and all event effects, checks HP/win conditions, switches turn, and creates the complete next state.
4. It commits the state and move receipt atomically, typically in a Firestore transaction when concurrent submissions or reads require it.
5. The client receives the result, while the opponent receives the committed state through the realtime listener.

Do not split a single move into sequential calls for validation, transformation, HP/event updates, and turn switching. Avoid database-triggered follow-up writes for work that must complete before the move is considered committed. Triggers may remain appropriate for non-critical side effects, analytics, or notifications.

The transaction must be retry-safe: transaction callbacks may run more than once, so keep nondeterministic choices stable across retries or generate/store them in a way that guarantees one result per accepted move. Never send secrets or trust a client-proposed final board as authoritative.

If a move must touch multiple documents, keep the atomic write set small and explain why each document is needed. Consider whether a single match document is sufficient before adding more documents or writes.

## Phase 5 — Align regions and reduce database work

These steps depend on the actual Firebase deployment and should follow measurement:

- Cloud Functions: inspect the deployed function region, not just source defaults. Firestore: inspect the database location. Keep the function close to the database to avoid cross-region calls. Select a region that also serves the actual player population; database proximity and player proximity can trade off, so use measured user geography and latency rather than assuming one region is best.
- Check function generation/runtime, cold-start behavior, instance settings, and logs. Optimize cold starts only if they materially affect the observed distribution. Do not increase minimum instances without considering ongoing cost.
- Keep move payloads compact. Send only required intent/version/idempotency data; do not resend profiles, full history, or assets.
- Avoid reading unrelated collections/documents during the hot move path. Fetch only what validation and resolution require.
- Write the smallest complete authoritative state needed by listeners. Avoid rewriting large immutable history or unrelated profile documents on every move.
- Store move history append-only if required, and avoid making the board listener download an ever-growing move history. Consider separate history documents only if measurement and security design justify them.
- Review database indexes for query patterns used during moves. Exempt fields from indexing only when they are not queried or ordered on; do not remove indexes blindly.
- Inspect document size, index fanout, transaction retries/contention, and read/write counts. Keep rules evaluation and client listeners scoped to the required match.
- Be mindful of database billing and security rules when changing read patterns.

## Phase 6 — Avoid duplicate work in the client

- Ensure listener setup is stable and its cleanup is reliable. Avoid re-subscribing on every render or on dependencies that change unnecessarily.
- Keep game state updates narrow. Do not rebuild the entire app/board for unrelated presence, chat, or cosmetic metadata changes.
- Memoize expensive board derivations and callbacks where the framework benefits, but profile before adding complexity.
- Separate authoritative match state from ephemeral UI state such as selection, hover, animation, and pending indicators.
- Avoid parsing, sorting, or replaying the full move history on every snapshot if a compact current board state is available.
- Do not suppress legitimate updates with stale closures or incorrect memoization. Correctness takes priority over render counts.

## Phase 7 — Retries, idempotency, and concurrency

Network retries and duplicate taps must not apply a move or charge event HP twice.

- Generate a unique moveId for one user intent and reuse that same ID for retries.
- Persist or atomically record the accepted result/receipt for that ID. A repeated request returns the original result instead of applying side effects again.
- If the same ID is reused with different move content, reject it.
- Include the expected match version/ply and reject stale submissions with the latest canonical state so the client can reconcile.
- Make simultaneous requests deterministic: at most one move should advance a given version/turn. Use transaction preconditions or equivalent atomic compare-and-set semantics.
- Distinguish transient errors (retry with bounded exponential backoff and jitter) from permanent rejection (illegal move, wrong turn, membership failure, stale version).
- Stop retries after a bounded policy; surface recoverable network state and allow a safe retry using the same moveId.
- Ensure random events, HP changes, bombs, reversals, transformations, and other side effects occur at most once per accepted move.
- Test reconnect and app resume while a move is pending. On reconnect, fetch/re-subscribe to canonical state and resolve the pending move by receipt/version before sending a new intent.

## Phase 8 — Realistic verification

Use a staging environment and two independent clients. Test with local development and deployed warm functions; cold-start scenarios if applicable; both players in the same region, then representative remote regions/geographies; network throttling or controlled latency, jitter, packet loss, and brief disconnect/reconnect; browser background/foreground transitions and mobile-sized/low-powered devices if supported; duplicate taps, delayed responses, retries, stale versions, two submissions racing, invalid moves, server rejection after optimistic rendering, and a player leaving mid-request; snapshot reconnects, duplicate snapshots, and unrelated document updates.

Compare results to the recorded baseline and publish p50/p95/p99 per phase, sample count, failure/rejection rate, and environment. Confirm rollback/reconciliation and hidden information remain correct. Do not claim the latency target is met from a single local test.

## Phased implementation plan

### Phase 1: Inspect and instrument
Map the actual architecture, create a sequence diagram or concise flow note, add correlation IDs and timing points, and capture a baseline. Make no architectural migration.

### Phase 2: Remove clear client-side delays
Fix demonstrated UI waits, duplicate listeners, polling, or unnecessary rendering. Add immediate optimistic board updates with rollback/reconciliation while preserving server authority. Measure again.

### Phase 3: Stream and consolidate authoritative updates
If Firestore is confirmed, ensure one correctly scoped realtime match listener. If the move path uses multiple calls/writes, consolidate critical validation and state transition into one authoritative operation and atomic commit where appropriate. Add idempotency and version checks.

### Phase 4: Optimize measured backend and data costs
Align function/database regions based on deployment and user geography. Reduce measured excess reads, writes, payload, index work, transaction contention, or cold-start impact. Keep each change isolated enough to compare.

### Phase 5: Load and adverse-network verification
Run the realistic scenarios above, compare percentiles against baseline and targets, inspect logs for duplicate processing and listener leaks, and document remaining bottlenecks and any justified follow-up.

At every phase: preserve existing rules; make incremental changes; review security rules and server validation; report files/configuration changed, evidence for the chosen optimization, before/after measurements, and known limitations.

## Acceptance criteria

1. The agent documents the actual architecture and end-to-end move path, with evidence from the repository/configuration.
2. Baseline and post-change timing reports include p50, p95, p99, sample count, test setup, and separate local responsiveness/opponent propagation measurements.
3. A valid move appears immediately on the moving player board (target ≤100 ms), and server rejection restores canonical state without leaving stale UI state.
4. On the agreed representative normal-network staging setup, the opponent sees a committed move within 1 second at p95, or the report explains with measurements why the target is not achievable and identifies the remaining bottleneck.
5. Every move legality decision, transformation, random event, HP effect, hidden information, turn switch, and game-end result is computed or validated authoritatively.
6. Duplicate submissions/retries with the same move ID do not duplicate state changes or costs; conflicting/stale/concurrent moves are rejected or reconciled safely.
7. Realtime subscriptions are cleaned up correctly and do not multiply during normal navigation/rerender/reconnect.
8. No unrelated rebuilds or full-history processing remain on the hot board update path without a measured reason.
9. Realistic network testing covers latency/jitter, disconnections, retries, races, rejection rollback, and reconnect.
10. The final report lists changes, tests performed, before/after metrics, and any remaining risks or work.

## Coding agent instruction

Start by inspecting the existing code and configuration. Write down what the current move path actually does and measure each stage before choosing a fix. Then implement the smallest evidence-based improvement in phases, preserving server-authoritative rules and reconciling optimistic UI state safely. Do not assume a specific implementation until inspection confirms it, and do not migrate databases just to pursue a latency target.

