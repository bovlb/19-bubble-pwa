# 19-Bubble Roll-and-Write PWA — Codex Implementation Specification

Version: 1.0 · Date: 2026-11-03 · Status: ready for implementation planning

## 1. Instructions to the implementing agent

Build a complete, serverless, offline-capable player for the game specified below. This document is the source of truth; do not import rules from a commercial game. Do not reproduce official boards or artwork.

Before any major implementation change, present a concrete plan and obtain the owner's approval. Make repository changes in a worktree and create a pull request. First inspect the target repository and its instructions. If no repository or remote is provided, request one before repository implementation; do not invent a destination. Creating this specification does not authorize deployment.

**Fixed** requirements are settled product or gameplay rules. **Default** decisions below are concrete implementation choices, not historical agreements. Adopt them in the implementation plan unless there is a justified alternative. Changes to deterministic formats require explicit versioning. No gameplay clarification is outstanding.

Deliver source, tests, bundled dictionaries and licenses, reproducibility fixtures, build/deployment configuration, and concise setup and user documentation. The requested product is the player and exact board scorer, not a move solver, photographic scorer, leaderboard, account system, or real-time multiplayer service.

## 2. Fixed game rules

- A board contains exactly 19 distinct bubbles on a triangular lattice. The graph is connected and generated procedurally from the challenge identifier.
- Two distinguishable dice have faces 0–5 and 1–6 respectively. Each turn reveals one pair. Every player of a challenge receives the same graph and ordered 19 pairs.
- Each of five operations can be submitted at most four times in a game:

| Operation ID | Display | Result for dice a, b |
|---|---|---|
| add | + | a + b |
| subtract | − | abs(a − b) |
| multiply | × | a × b |
| min | min | min(a, b) |
| max | max | max(a, b) |

Subtraction permits either operand order but no negative result; absolute difference implements it. Zero is legal. There is no placement-value cap. These dice and operations naturally produce values from 0 through 30, but do not impose an artificial cap of 12.

- Each turn commits exactly one operation and fills exactly one previously empty bubble with its result.
- The first placement may use any bubble. Every later placement must share an edge with at least one occupied bubble. No numeric relationship is required.
- Play ends after exactly 19 committed moves. Of the 20 available operation uses, exactly one remains: final operation counts, sorted, are [3, 4, 4, 4, 4].
- Selections are provisional until Submit. Equal results from different operations remain distinct choices with separate use counters.

## 3. Fixed scoring semantics

Score occupied bubbles only. Empty bubbles are neither groups nor orphans. Calculate the exact highest total score automatically after every submitted move and at completion.

### Runs

A candidate run is a simple ordered path of at least two distinct occupied nodes. Consecutive nodes share a graph edge, and values increase by **exactly one** at each step. A branching subgraph, an arbitrary increasing sequence with gaps, or numerical proximity without edges is not a run. Enumerate all eligible paths, including non-maximal subpaths; selecting only maximal or longest paths can miss the optimum.

Selected runs must be pairwise node-disjoint. A node may simultaneously belong to one selected run and a scored set.

### Sets

A scored set is a **maximal connected component** of equal-valued occupied nodes, with at least two nodes. Score each such component exactly once. Do not split a component into smaller scored sets or count its subsets. Singleton components do not score. All qualifying sets score; they do not compete with runs.

### Group scores, bonuses, and orphans

Each run or set scores `h + n − 1`, where h is its highest value and n its node count. For a set, h is its common value.

Award one bonus for the longest **selected** run, and one for the longest scored set. Ties do not multiply bonuses. If a category has no group, its bonus is zero.

| Longest length | Bonus |
|---|---:|
| 0 or 1 (no qualifying group) | 0 |
| 2 | 0 |
| 3 | 1 |
| 4 | 3 |
| 5 | 6 |
| 6 | 10 |
| 7 | 15 |
| 8 | 20 |
| 9 | 25 |
| n ≥ 10 | 25 + 5 × (n − 9) |

An orphan is an occupied node covered by neither a selected run nor a scored set. Merely belonging to an unselected candidate run does not prevent orphan status. Each orphan costs 3 points.

For selected runs R, fixed sets S, and orphan count O:

```text
runPoints = sum(h(r) + length(r) − 1 for r in R)
setPoints = sum(h(s) + size(s) − 1 for s in S)
subtotal = runPoints + setPoints + longestRunBonus + longestSetBonus
total = subtotal − 3 × O
```

Optimize **total**, including coverage and the single longest-run bonus, over every legal selection R, including the empty selection. Do not maximize subtotal first and subtract penalties afterward. Do not sum a bonus for each run. Negative totals are valid.

Return selected paths, sets, orphan node IDs, both longest lengths, both bonuses, group point sums, subtotal, penalty, and total. This is an auditable scoring certificate for the UI and tests.

### Running score and monotonicity correction

Show Runs, Sets, Longest run bonus, Longest set bonus, Subtotal, Orphan penalty, and Current score separately. Label incomplete-board scores as current/provisional. Group highlights may change when another bubble is filled.

**Do not promise a monotonic subtotal or total.** Optimizing total may select a different subtotal. Also, maximal same-value components can merge, replacing two scored sets with one. For example, a five-node chain with values [5, 5, empty, 5, 5] has set points 12 and no bonus; filling its center with 5 produces set points 9 plus bonus 6. With two length-three components [5,5,5,empty,5,5,5], the subtotal changes from 15 to 26. These demonstrate recomputation, not a general monotonicity guarantee. A stronger counterexample uses two length-two value-30 components separated by an empty center: subtotal 62 becomes 34 + 6 = 40 when filled with 30. Such fixtures may be scorer-only states. Separate penalty display is required; a monotonically increasing score component is not.

## 4. Exact scorer: default algorithm and proof obligations

Use 19-bit node masks and a UI-independent pure scoring module. Find equal-value components by traversal. Let `C` be their union and `F` the occupied mask. Enumerate increasing run paths by DFS along edges from value v to value v+1; strictly increasing values prevent cycles. Canonicalize paths by node-ID sequence.

One exact dynamic-programming design:

1. For each candidate run record mask, length, and base points.
2. Maintain reachable states `(M, L)` where M is the union of selected-run nodes and L is the longest selected-run length. Store the maximum sum of run base points and a reconstruction witness for each state.
3. Initialize `(0, 0)` with zero. Extend a state by any run whose mask is disjoint from M. Process by increasing popcount(M), so transitions always move forward. Keep the better base score for identical `(M, L)` states.
4. Evaluate each state as `base + setPoints + B(L) + B(longestSet) − 3*popcount(F & ~(M | C))`. Mask complements to the 19-node domain.
5. Return the greatest total and its witness.

Keeping only the best base score per `(M,L)` is safe: the other score terms and all future compatibility depend only on that state. Every legal run collection is reachable by adding its runs. Alternatives such as branch-and-bound are acceptable only if exactness is demonstrated against an independent exhaustive oracle.

Default deterministic tie-break: higher total, then higher subtotal, then fewer runs, then lexicographically smaller canonical collection of node-ID paths. Sort each collection lexicographically before comparison. This affects explanation, not the score.

Run expensive scoring in a worker if needed. Never silently substitute a greedy answer, time-limited approximation, or stale result labeled as current. Associate asynchronous answers with a board revision; ignore obsolete replies. Benchmark worst-case fixtures before selecting a memory strategy; a sparse DP can still grow large.

## 5. Challenge identity and deterministic protocol

**Fixed:** memorable adjective–noun petnames, check digits, limited autocorrection, bundled immutable versioned dictionaries, and deterministic board and dice. No server lookup is required. A challenge identifies an arrangement and roll sequence, not a player or unique hosted room.

The following is a fully specified **default v1 protocol**. Freeze it before release and commit golden vectors. Protocol version bundles rules, dictionary edition, generation algorithm, and dice derivation. New incompatible behavior gets a new version; existing codes retain their original meaning.

### Dictionaries and names

- Bundle two nonempty lists: adjectives and nouns. Select and document a redistributable source/license or create original lists; include attribution where required. Dictionary selection and size are implementation choices, not settled game rules.
- Canonical entries contain lowercase ASCII letters only, are unique within their list, and are sorted by ASCII bytes. Avoid confusing, offensive, or awkward entries. Commit exact UTF-8 files with LF endings, final newline, edition identifier, and SHA-256 digests. Never fetch dictionaries at runtime.
- Canonical code: `v1-adjective-noun-DD`, where DD is exactly two decimal digits. Display uppercase if desired; internal form is lowercase. Spoken/manual v1 entry may omit `v1-`; omission always means v1, even after future releases.
- Canonical identity string K is `v1:adjective:noun`, with literal colons and no whitespace or trailing newline.
- Check digits: interpret the entire SHA-256 digest of UTF-8 `bubble19:check:` concatenated with K as an unsigned big-endian integer; take modulo 100 and pad to two digits. Compute modulo incrementally over digest bytes to avoid number precision loss.
- Check digits detect mistakes probabilistically; they are not authentication, extra entropy, or a guarantee against collisions. Do not hardcode illustrative petnames/check digits as valid.

### Parsing and correction

Default input uses adjective, noun, and two-digit fields, with a paste-full-code option. Trim surrounding whitespace, lowercase ASCII, and accept spaces or hyphens as separators. Require unambiguous tokens; do not concatenate arbitrary words or guess missing digits. Validate supported version before dictionary lookup.

Accept exact dictionary words only when their checksum matches. Never change an already valid code. For an unrecognized word, generate same-category candidates within Levenshtein distance one (insertion, deletion, or substitution). Keep recognized words fixed. Allow at most one edit per unrecognized word. Filter complete candidate pairs by the supplied, unchanged checksum and version.

- One surviving candidate: autocorrect, visibly show the corrected full code, and join it.
- Multiple: present choices and require selection; never pick arbitrarily.
- None, wrong check digits with exact words, absent digits, or unknown version: show a specific recoverable error and preserve input.

No phonetic guessing, digit autocorrection, transposition-specific rule, or silent version change in v1. Tests must exercise checksum collisions and ambiguous candidates with controlled test dictionaries.

### Random streams

Avoid platform-dependent random generators. Default uses SHA-256 counter streams, so no unspecified PRNG is needed:

```text
block(domain, i) = SHA256(UTF8("bubble19:" + domain + ":" + K + ":" + decimal(i)))
```

Domain is `graph` or `dice`; i starts at 0 with unpadded decimal representation. Consume every block's bytes in order, concatenating blocks as needed. Read unsigned 32-bit big-endian words, four bytes at a time. Each domain has its own counter and cursor.

For uniform integer below positive m ≤ 2^32: let limit = floor(2^32/m)*m, discard words x ≥ limit, and return x mod m for the first accepted word. Integer arithmetic here is exactly representable in JavaScript numbers. Changing graph consumption must never change dice.

Generate all 19 pairs from the dice stream in order: a = draw(6), then b = 1 + draw(6). Reveal only the current pair in normal gameplay. Client-side determinism is reproducibility, not protection against inspecting future rolls.

Start Game selects an adjective and noun uniformly using browser cryptographic randomness and unbiased rejection sampling, then derives the challenge. Joining uses no fresh randomness. Duplicate random names are valid repeated challenges; there is no global uniqueness guarantee.

## 6. Procedural graph: default v1 generator

Use integer axial coordinates (q,r), with the six neighbor offsets:

```text
(1,0), (0,1), (-1,1), (-1,0), (0,-1), (1,-1)
```

Start with {(0,0)}. Until there are 19 positions:

1. Build the unique unoccupied frontier adjacent to the current positions.
2. Sort by q ascending, then r ascending using integer comparison.
3. Give each frontier position weight k², where k is its number of already occupied neighbors.
4. Draw an integer below the sum of weights from the graph stream. Choose by cumulative weights in sorted order and add that position.

This yields bounded, connected growth with a compactness bias. No rejection filters, retries, floating-point probabilities, runtime hash-map ordering, or time-dependent heuristics are part of v1.

Normalize by subtracting min(q) from every q and min(r) from every r. Sort the final coordinates by q then r; assign IDs 0–18 in that order. Include **every** edge whose coordinate difference is one of the six offsets. Store edges as `(lowerID, higherID)` sorted lexicographically, once each; no self-edges. Do not retain only growth-parent edges.

For SVG rendering use x = q + r/2, y = sqrt(3)*r/2 and fit the bounding box with padding. Floating-point display coordinates never influence IDs or edges. Preserve canonical orientation in v1. Shape quality tuning is an implementation choice requiring a new generator/protocol version after publication.

## 7. Screens and turn state machine

### Home

Provide Start Game, Join Game, and Continue Game when valid local progress exists. Start shows the complete code and a copy/share challenge link. Join accepts typed codes and links. A challenge link opens that challenge; if it has a local attempt, offer Continue or explicitly start a separate attempt. Never silently overwrite another game.

Default: retain multiple attempts locally, identify each by a local random attempt ID, and make Continue open the most recently active unfinished attempt, with a list to choose others. No account, login, or synchronization.

### Playing

Show code, progress, the connected board, both dice, operation choices with remaining uses, selected result, Submit Move, and scoring breakdown. Label completed moves explicitly (for example “6 of 19 placed”) and next/current turn without off-by-one ambiguity.

```text
awaitingRoll → choosingMove → awaitingRoll
                           → completed (after move 19)
```

Roll reveals the predetermined next pair exactly once and immediately persists the revealed state. Rolling does not consume an operation. Reloading does not hide or reroll it. In choosingMove, operation and bubble may be selected in either order and changed freely. Highlight eligible empty bubbles. Submit is enabled only with a valid operation and legal bubble. Submit atomically appends one move, consumes one use, updates the board and score, clears provisional choices, saves, and advances phase. Prevent duplicate submissions and extra rolls through engine validation, not only disabled buttons.

Default: no committed-move undo in v1; the prior assistant suggested it, but it was not a settled rule. Selection changes before Submit remain available. Restarting creates a distinct attempt and never changes the challenge. Undo can be considered separately with explicit policy about already revealed dice.

### Results and sharing

After move 19, show final score and full breakdown, completed board, group/orphan highlights, Share Result, and New Game. Disable further moves and rolls. Copy/share text includes full versioned code, total, breakdown, and challenge link so friends can play the same puzzle.

Default link format is a fragment under the deployed application root: `#challenge=<percent-encoded-canonical-code>`. Fragment routes work on static hosting without deep-path rewrites. Parse links strictly and escape all user-controlled display text.

Required result sharing is text plus a challenge link. Default additional result link uses `#result=<base64url-encoded-UTF8-JSON>` containing `{schema:1, code, moves:[{nodeId,operation}]}`. Limit decoded payload to 8 KiB, require exactly 19 legal moves for a completed result, reconstruct rolls and values, and recompute the score. Reject invalid IDs, operations, excessive data, unsupported schemas/versions, and impossible histories. Do not trust an embedded score. Open as a read-only result; offer a separate action to play its challenge. Result imports never overwrite local attempts.

Use the native share sheet where available and copy/manual selectable text fallbacks. Sharing must require a user action. No automatic messages or uploads. Shared results are reproducible claims, not tamper-proof competition records.

## 8. Local persistence and offline behavior

**Fixed:** local save, continue, and offline play. **Default:** IndexedDB for versioned attempts/settings; localStorage is acceptable if the plan justifies its limits.

Store schema version, challenge code/version, attempt ID, timestamps, committed move log, phase/revealed status, and optional provisional selection. Recompute board, counters, dice, and score from validated history. Cached derived values are never authoritative. Persist after Roll and Submit, not only on unload. A revealed pair must survive refresh; provisional selections may be cleared without consuming anything.

Use transactional saves or one atomic record replacement. On persistence failure keep the in-memory game playable but clearly report that it is not saved and provide retry/export. Never claim success. Detect stale writes from another tab using a revision or equivalent concurrency guard. Preserve a last valid record on malformed imports or failed migrations; offer recovery/reset without silently deleting history. Browser storage can be cleared by the user or browser; do not promise cloud backup.

After one successful online load and cache completion, cold-launch offline, start/join from bundled codes, continue, play, score, and generate copyable result text/links. Opening an uncached site for the first time offline is outside the guarantee; sending a message externally may need connectivity.

## 9. Technical architecture and GitHub Pages PWA

Defaults: TypeScript, Vite, SVG board, a small component-based UI, and a test runner supporting unit/property tests plus browser end-to-end tests. Framework/library selection and exact versions belong in the approved plan and lockfile, not gameplay rules.

Separate pure modules for protocol, graph generation, dice, operations, move validation/replay, and scoring from storage, routing, sharing, service worker, and UI. Suggested contracts:

```typescript
parseChallenge(input): ParseResult
generateChallenge(code): Promise<Challenge>
legalMoves(state): Move[]
applyMove(state, move): State // reject invalid phase or move
replay(challenge, moves): State
score(graph, values): ScoreBreakdown
```

The scorer accepts validated graph/value fixtures independently of dice histories. A future solver can reuse the engine, but implement neither search advice nor camera recognition now.

Deploy static build artifacts to GitHub Pages with repository-subpath-aware URLs for assets, manifest start_url/scope, service worker, and shared links. Provide manifest name, short name, theme/background colors, standalone display, and suitable 192/512 icons including a maskable option. Use HTTPS on the hosted app. Bundle fonts/assets or use system fonts; no runtime CDN dependency.

Precache app shell, versioned dictionaries, protocol implementations, and required assets. Use versioned caches with an atomic installation strategy. Do not force-reload an active game when an update arrives. Offer an update at a safe point after saving. Retain old protocol support and prevent mixed-version assets. Verify offline navigation at the actual Pages base path, not just localhost `/`.

Touch and accessibility: readable on an iPad in portrait/landscape and a narrow phone; no horizontal page scrolling; large touch targets (aim for 44 CSS px); keyboard-operable controls and board; visible focus; labels for dice, values, legal state, and remaining uses; non-color indicators for selection/groups; polite announcements of rolls, submissions, and scores. Explain add/subtract/multiply/min/max in plain language. Account for overlapping run/set highlights.

No backend, accounts, analytics, external fonts, or network calls during normal cached gameplay. Document local storage and user-initiated sharing accurately.

## 10. Acceptance tests — required release gates

### A. Arithmetic and turn legality

1. Exhaustively verify all 36 die pairs for all five operations. For (0,6), results in table order are [6,6,0,0,6]; for (5,1), [6,4,5,1,5]; for (5,6), [11,1,30,5,6].
2. On an empty board all 19 nodes are legal. After placing, only empty graph neighbors of occupied nodes are legal; a numerically unrelated value is accepted there. Occupied/nonfrontier targets are rejected without mutation.
3. Reject a fifth use, move before roll, second roll in choosingMove, incomplete selection, duplicate submit, and any move after completion. Equal-result operations consume only the selected operation.
4. For generated legal histories, after t moves occupied count and sum of uses equal t, each use count ≤4, remaining capacity equals 20−t, and occupied nodes form a connected subgraph. After 19 moves sorted counts equal [3,4,4,4,4].

### B. Hand-calculated scoring fixtures

For these engine unit fixtures, only listed nodes/edges exist or all unlisted nodes are empty. They need not be complete playable histories. “Chain” means consecutive edges only. Assert the full certificate as well as the total.

| Fixture | Expected |
|---|---|
| Empty board | All score fields 0; no orphans |
| Single occupied value 7 | No groups; penalty −3; total −3 |
| Chain [1,2] | Run points 3; bonus 0; total 3 |
| Chain [0,1,2] | Run points 4; run bonus 1; total 5 |
| Chain [1,3] | No run or set; two orphans; total −6 |
| Chain [0,0] | Set points 1; total 1 |
| Chain [5,5,5] | One maximal set: points 7, bonus 1; total 8 |
| Chain [1,2,2] | Run points 3 plus set points 3; shared node allowed; total 6 |
| Chain [1,2,3,4] | Whole run: base 7 plus length-four bonus 3 = 10; splitting into [1,2] and [3,4] yields only 8 |
| Star: center 2, leaves 1,3,3 | Best run points 5, bonus 1; other 3 orphan; total 3. Leaves are not adjacent and are not a set |
| Two disconnected chains [1,2,3] and [5,6,7] | Run points 5+9; one run bonus 1; total 15 |
| Two disconnected sets [4,4,4] and [7,7,7] | Set points 6+9; one set bonus 1; total 16 |
| Chain [1,2,3,4,5,6,7,8,9,10] | Validate optimum against oracle; separately assert a length-10 candidate has base 19 and bonus 30 |

Test deterministic tie-breaking separately with symmetric equal-score paths.

**Coverage-sensitive optimizer fixture:** nodes a=9,b=10,c=11,d=10,e=9 with edges ab,bc,cd,de,bd. The set is {b,d}, worth 11. The run a-b-c has base 13 and bonus 1, leaving e orphan, for total 22. Two disjoint runs a-b and d-c have base 11+12=23 but leave e orphan, giving 31. Two disjoint runs a-b and e-d-c have base 11+13=24, bonus 1, cover all nodes, giving **36**. Assert the oracle and production scorer both return 36, with sets overlapping runs legally. This fixture exercises competing paths; also generate and retain a brute-force-discovered fixture where maximizing subtotal alone chooses a strictly worse total than coverage-aware scoring.

Test B(n) at every n from 0 to 19, including B(9)=25, B(10)=30, B(19)=75. Test merged maximal sets, shared run/set nodes, repeated values on different branches, disconnected equal values, and orphans present only because a candidate run was not selected.

### C. Exactness and reproducibility

1. Implement an independent small-graph exhaustive oracle: enumerate all candidate paths, all pairwise-disjoint subsets, and compute scores directly. Compare totals and witness validity with production on exhaustive small fixtures and at least 1,000 seeded random fixtures with up to eight occupied nodes. Include lattice-realizable cases and synthetic graph-unit cases.
2. Verify each returned path's edges and +1 increments, run disjointness, maximal sets, coverage union, orphan IDs, bonus lengths, and arithmetic independently. Input permutation cannot change score; stable node IDs yield a stable tie-break.
3. Include regression fixtures where longest-first and highest-group-score-first greed fail, non-maximal paths are necessary, and subtotal-only optimization fails. Discover fixtures with the oracle if needed, then freeze explicit values/edges/expected totals; do not use the production implementation to manufacture expected answers.
4. Freeze golden vectors for at least ten actual valid codes: exact dictionary digests, checksum, canonical coordinates/IDs/edges, all 19 die pairs, and a legal move history with independently checked final score. Cross-check hash/stream vectors with a second implementation. Run in supported desktop and iPad browser engines; never auto-regenerate expected files in tests.
5. Over at least 1,000 generated codes verify 19 unique coordinates, connectivity, six-neighbor induced edges, no duplicate/self edges, stable normalization and IDs, correct dice ranges, and repeatability. Domain separation test: consume additional graph-stream bytes and show the dice stream is unchanged.
6. Check parsing case/separators, leading-zero checksums, exact valid names, unique correction, ambiguous correction, invalid checksum, missing fields, unsupported versions, and dictionaries available offline. Versionless input remains v1 forever.

### D. End-to-end persistence, sharing, and PWA

1. Start, copy code/link, and join on a clean device/browser profile: graph and all subsequently revealed rolls match. Different local move choices do not affect later rolls.
2. Refresh before Roll, immediately after Roll, after provisional selection, after Submit, and after completion. No extra turn/use is consumed; revealed dice and committed history survive.
3. Complete a full game through the UI. Verify counters, final breakdown, result text, challenge link, and read-only result replay. Corrupt each payload field in tests and verify safe rejection without overwriting saves.
4. Test failed/quota-limited storage, malformed saves, unsupported schemas, two-tab stale writes, and interrupted migration. The UI reports unsaved state honestly.
5. Serve the production build under a non-root path matching GitHub Pages. Cache fully, close, disable network, cold-open, start/join/continue, finish, and copy a result. Confirm no required runtime network request.
6. Install and launch standalone where supported. Test an update while a turn is revealed: progress survives and no forced reload changes the pair. Old-version challenges still reproduce.
7. Verify actual iPad Safari touch/layout, landscape/portrait, share fallback, keyboard navigation, focus, labels, contrast, and non-color group indicators. Record device/OS/browser versions tested; do not claim manual device testing when only emulation ran.
8. Benchmark scoring with 19-node adversarial/value-rich fixtures and generated boards on a documented representative mobile device. Default target: 95th percentile ≤250 ms over at least 1,000 scored boards; any longer computation remains responsive and visibly pending. Report maximum time and memory. Exactness is mandatory even if the target requires algorithm revision.

## 11. Implementation sequence and definition of done

Present and obtain approval for a repository-specific plan first. Suggested sequence:

1. Pure rules, exhaustive oracle, scoring fixtures, and exact scorer.
2. Frozen identity/dictionary/graph/dice protocol with independently checked vectors.
3. Accessible game UI, validated state machine, save/resume, and sharing.
4. Service worker/manifest, actual Pages-subpath build, offline/update tests, and iPad QA.

Each stage should remain testable without the next. Use synthetic boards only in development fixtures; the shipped player uses generated boards from day one. In the PR, distinguish automated passes, manual checks actually performed, unresolved issues, and any approved deviations from defaults. Document commands to develop, test, build, and deploy plus protocol compatibility and storage limitations.

Done means every fixed requirement is implemented, release-gate tests pass, the exact scorer is independently validated, no placeholder dictionary/protocol vectors remain, the static build works at the target Pages path, and a reviewable PR includes evidence. Publishing requires the owner's deployment authorization. No optional solver, OCR, undo, or online service is needed for completion.

## Approved extension: manual paper scoring (November 2026)

Provide a separate **Score a paper game** entry point: create board, share board,
score board. Users select 19 connected positions on a triangular grid, optionally
name the shape, and enter 0–30 or blank into each bubble. Derive all neighbor
edges automatically and reuse the exact scorer without requiring move history.
Keep partial scores distinct from complete scores and blank distinct from zero.

Share only the shape and optional name through a versioned, validated URL-safe
fragment with no equals signs. Opening a shape link enters manual scoring
immediately. Store paper scores locally and preserve earlier scores when starting
a fresh score. Do not bundle official map artwork or photographic recognition.
The existing result-share text contains only the score breakdown and challenge
link; the optional long replay link described in section 7 is no longer emitted.
