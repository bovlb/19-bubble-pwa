# 19 Bubbles

A serverless, offline-capable roll-and-write player implementing [SPEC.md](SPEC.md). Nineteen bubbles, two distinguishable dice, five operations, and an exact, auditable scorer. No backend, accounts, telemetry, solver, or external runtime assets.

## Develop and verify

Use Node 22.12+ (also tested with Node 24) and pnpm 11.25.0.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm build
pnpm exec playwright install chromium webkit
pnpm test:e2e
```

The application base is `/19-bubble-pwa/`, including local development and preview. `pnpm preview` serves the production bundle. `USE_SYSTEM_CHROME=1 pnpm exec playwright test --project=chromium` uses an installed Chrome when the bundled browser is unavailable.

The GitHub Verify workflow runs unit/oracle/protocol tests, builds the app, runs Chromium and WebKit integration tests, and uploads the static artifact. The separate **Deploy Pages (manual authorization)** workflow runs only when explicitly dispatched. Set repository Pages source to GitHub Actions before authorized deployment. Nothing deploys on push or pull request. Review the outstanding physical-device gates in [QA.md](docs/QA.md) before release.

## Play

Start a game or enter an adjective, noun, and two check digits. Full codes and challenge links can also be pasted. If a code already has a local attempt, choose Continue or explicitly start another attempt. Multiple local attempts are retained.

Roll reveals the next pair and saves it. Choose an operation and an outlined empty bubble in either order, then Submit. Each operation has four uses. After the first move, placement must touch a filled bubble. There is no undo after submitting. Wait for **Saved on this device** before closing; saving is asynchronous. Save failures leave the in-memory game playable with retry and JSON export. Import an export from the home screen to recover it as a separate attempt.

Runs follow graph edges with values increasing by exactly one. Sets are maximal connected groups of equal values. Each group scores its highest value plus its size minus one. Runs cannot overlap other selected runs; sets can overlap runs. The longest run and longest set each receive one bonus. Uncovered occupied bubbles cost three points each. Exact optimization may change group highlights and decrease the score. R/S labels and dashed set outlines distinguish overlapping groups without relying solely on color.

Share Result provides text, a challenge link, and a validated read-only replay link. Native sharing falls back to clipboard, then selectable text. Sharing is user initiated. A shared result is a reproducible claim, not a tamper-proof record.

## Offline and storage

After the first successful load and cache completion, **Ready for offline play** indicates that the shell, bundled dictionaries, worker, and assets are cached. Subsequent offline launches support new games, joins, continuing, scoring, and result text. An uncached first visit requires connectivity.

IndexedDB stores schema-1 attempt records: canonical code, attempt ID, timestamps, revision, committed move log, and revealed phase. Derived values are replayed rather than trusted. Transactions compare revisions to reject stale writes from other tabs. Unknown or malformed records are retained and exportable alongside valid attempts; schema 1 has no historical migration path. Result imports do not write attempts. Recovery imports create a new ID.

Updates install all assets before activation and wait for a user action at a saved between-turn/completed state. Active games are never force-reloaded. Each worker serves its own immutable cache; previous caches are retained so older open tabs can finish loading their assets. This prioritizes safety over automatic cache reclamation and uses additional storage across releases. Clearing browser storage removes local games and caches; there is no cloud backup.

## Implementation

- `src/engine/rules.ts`: arithmetic, legal placement, phase guards, immutable transitions, validated replay.
- `src/engine/protocol.ts`: immutable v1 dictionaries, checksum/correction, independent SHA-256 graph/dice streams, induced triangular-lattice graph.
- `src/engine/score.ts`: exact pivot recurrence with memoization and deterministic witnesses; see [proof and tests](docs/SCORER.md).
- `src/scorer.worker.ts`: scoring outside the UI thread, with revision-tagged replies.
- `src/storage.ts`, `src/sharing.ts`: transaction guards, recovery exports, bounded validated result import.
- `vite.config.ts`: hashed production-cache generation and Pages subpath.

Original dictionary edition v1 contains 32 adjectives × 32 nouns (1,024 challenge identities). These are intentionally memorable, not globally unique or secret. The independently assembled word lists are CC0; see `src/dictionaries/LICENSE.txt`. Their exact SHA-256 digests and ten frozen protocol vectors are in `tests/golden.json`. Do not reorder/change dictionaries or generation under v1. Any incompatible protocol change needs a new version, while retaining v1. Versionless codes always mean v1.

`scripts/golden.py` is an independent Python SHA-256/generation/scoring implementation used to produce the committed vectors. It is never invoked by tests. `scripts/discover-regressions.py` independently searches for scoring counterexamples; its committed fixtures are also never regenerated by tests. Changes to either fixture file require explicit review.

## Manual scoring for paper games

Choose **Score a paper game** from the home screen. Tap exactly 19 connected
positions on the triangular grid to match the paper board, and optionally name
it. **Expand grid** provides more room. Connections are automatic between all
neighboring selected positions; official map artwork is not bundled.

**Share board** sends only the shape and optional name, never entered numbers.
Links use `#shape/1.<positions>.<checksum>/<optional-name>` with URL-safe,
unpadded encoding and no equals signs. Opening a link goes directly to number
entry. New recipients see empty fields; a returning recipient resumes their
own latest saved score for that shape. **Start fresh score** keeps the previous
score and starts another. Shapes shared from the editor are also saved locally.

Enter integers from 0 to 30; a blank bubble is different from zero. Enter/Tab
moves to the next input. The existing exact worker scorer shows the total,
breakdown, and selectable run/set/orphan highlights. Partial scores are labeled
current. No dice history is required. This mode uses the app's scoring rules.

Paper boards and scores save in this browser's local storage, separately from
played games. They work offline after the app is cached. Unreadable saved data
is retained; save failures remain visible and offer retry. Clearing browser
storage removes these records.
