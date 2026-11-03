# Exact scoring and witness reconstruction

The production scorer first traverses equal-valued connected components. Every component of size at least two is a fixed scored set. Increasing DFS enumerates every candidate run, including all non-maximal prefixes and subpaths (a DFS begins at every occupied node). Values strictly increase, so no path can repeat a node.

The optimizer uses a canonical pivot recurrence instead of the specification's example forward DP. A state `(availableMask, longestSoFar)` returns the best suffix collection. Choose the lowest available node as pivot. Every legal collection belongs to exactly one of these cases:

1. The pivot is not in any selected run: remove it and recurse.
2. The pivot belongs to a selected candidate run: choose each compatible run containing it, remove the whole run, and recurse.

No legal collection is omitted. Masks strictly decrease, so recursion terminates. Set points and set bonus are constant. Start with an orphan baseline of −3 for every occupied node outside the set union. Every selected run then contributes its base score and +3 for each covered node outside sets. Run disjointness makes those coverage contributions additive. At the terminal state add exactly one bonus for `longestSoFar`. Thus maximizing this objective is identical to maximizing the specified total, including penalties.

Future possibilities depend only on the remaining mask and longest-so-far. Memoization is exact. Witness ties use total objective, then base points plus final run bonus (equivalent to subtotal), then fewer runs, then numeric lexicographic comparison of sorted node-ID paths. Prefix contributions are fixed for each state; merging the same sorted prefix into two suffix collections preserves lexicographic order.

After reconstruction, the scorer recomputes the actual orphan list and returns runs, sets, longest lengths, both bonuses, both point sums, subtotal, negative penalty, and total. Empty boards and negative scores are valid. Inputs are scorer fixtures independently of game histories, including fewer than 19 nodes or disconnected graphs.

## Independent checks

- A separate TypeScript oracle computes sets and paths independently, enumerates all compatible subsets, and evaluates their scores directly without production helpers.
- Exhaustive comparison over every four-node simple graph and every ternary value assignment (64 × 81 = 5,184 cases).
- 1,000 seeded random graphs with up to eight occupied nodes.
- Independent certificate validation: edges, unit increments, run disjointness, maximal sets, coverage/orphans, group arithmetic, lengths, bonuses, and total.
- Fixed hand-calculated chains, stars, disconnected groups, shared run/set nodes, merging sets, and the coverage-sensitive score-36 fixture.
- Independently discovered frozen failures for longest-first, highest-points-first, maximal-only, and subtotal-only optimization.
- Ten Python-generated complete legal histories with independently calculated final scores.

The worker never substitutes a heuristic or timeout answer. Pending computation is labeled, and replies from obsolete board revisions are discarded. Complexity is exponential in the 19-node domain; worst-case memory remains a release consideration, even when measured timings are small. See QA.md for measured results and outstanding device tests.
