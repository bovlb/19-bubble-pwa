import type { Graph } from "./rules";
export const bonus = (n: number) =>
  n < 3 ? 0 : n <= 7 ? ((n - 1) * (n - 2)) / 2 : 20 + 5 * (n - 8);
export type Group = { nodes: number[]; points: number };
export type Certificate = {
  runs: Group[];
  sets: Group[];
  orphans: number[];
  longestRun: number;
  longestSet: number;
  runBonus: number;
  setBonus: number;
  runPoints: number;
  setPoints: number;
  subtotal: number;
  penalty: number;
  total: number;
};
export function comparePaths(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++)
    if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}
function compareCollections(a: Group[], b: Group[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const c = comparePaths(a[i].nodes, b[i].nodes);
    if (c) return c;
  }
  return a.length - b.length;
}
export function score(graph: Graph, values: (number | null)[]): Certificate {
  const n = values.length;
  if (
    n > 19 ||
    values.some((v) => v !== null && (!Number.isInteger(v) || v < 0))
  )
    throw Error("Invalid score values");
  const adj = Array.from({ length: n }, () => [] as number[]);
  for (const [a, b] of graph.edges) {
    adj[a].push(b);
    adj[b].push(a);
  }
  adj.forEach((a) => a.sort((a, b) => a - b));
  const sets: Group[] = [],
    seen = new Set<number>();
  let setMask = 0;
  for (let i = 0; i < n; i++) {
    if (values[i] === null || seen.has(i)) continue;
    const nodes = [i];
    seen.add(i);
    for (let k = 0; k < nodes.length; k++)
      for (const j of adj[nodes[k]])
        if (values[j] === values[i] && !seen.has(j)) {
          seen.add(j);
          nodes.push(j);
        }
    if (nodes.length > 1) {
      nodes.sort((a, b) => a - b);
      sets.push({ nodes, points: values[i]! + nodes.length - 1 });
      nodes.forEach((j) => (setMask |= 1 << j));
    }
  }
  const candidates: (Group & { mask: number })[] = [];
  function walk(path: number[], mask: number) {
    if (path.length > 1)
      candidates.push({
        nodes: path,
        mask,
        points: values[path.at(-1)!]! + path.length - 1,
      });
    for (const j of adj[path.at(-1)!])
      if (values[j] !== null && values[j] === values[path.at(-1)!]! + 1)
        walk([...path, j], mask | (1 << j));
  }
  values.forEach((v, i) => {
    if (v !== null) walk([i], 1 << i);
  });
  candidates.sort((a, b) => comparePaths(a.nodes, b.nodes));
  const byNode = Array.from({ length: n }, (_, i) =>
    candidates.filter((c) => c.mask & (1 << i)),
  );
  const setPoints = sets.reduce((s, g) => s + g.points, 0),
    longestSet = Math.max(0, ...sets.map((g) => g.nodes.length));
  const occupied = values.reduce<number>(
    (m, v, i) => (v === null ? m : m | (1 << i)),
    0,
  );
  // Canonical pivot recurrence partitions every possible collection into: pivot unused,
  // or exactly one run containing pivot. Memoization includes longest length because
  // the single bonus depends on all selected runs. Orphan costs are additive here.
  type Answer = {
    runs: Group[];
    points: number;
    covered: number;
    longest: number;
    objective: number;
  };
  const memo = new Map<string, Answer>();
  function better(a: Answer, b: Answer) {
    const at = a.objective,
      bt = b.objective;
    if (at !== bt) return at > bt;
    const as = a.points + bonus(a.longest),
      bs = b.points + bonus(b.longest);
    if (as !== bs) return as > bs;
    if (a.runs.length !== b.runs.length) return a.runs.length < b.runs.length;
    return compareCollections(a.runs, b.runs) < 0;
  }
  function solve(available: number, longest: number): Answer {
    if (!available)
      return {
        runs: [],
        points: 0,
        covered: 0,
        longest,
        objective: bonus(longest),
      };
    const key = available + ":" + longest,
      cached = memo.get(key);
    if (cached) return cached;
    const bit = available & -available,
      i = 31 - Math.clz32(bit);
    let best = solve(available ^ bit, longest);
    for (const run of byNode[i])
      if ((run.mask & available) === run.mask) {
        const tail = solve(
          available ^ run.mask,
          Math.max(longest, run.nodes.length),
        );
        let coverage = 0;
        for (const j of run.nodes) if (!(setMask & (1 << j))) coverage++;
        const a: Answer = {
          runs: [run, ...tail.runs].sort((a, b) =>
            comparePaths(a.nodes, b.nodes),
          ),
          points: run.points + tail.points,
          covered: run.mask | tail.covered,
          longest: tail.longest,
          objective: run.points + 3 * coverage + tail.objective,
        };
        if (better(a, best)) best = a;
      }
    memo.set(key, best);
    return best;
  }
  const best = solve(occupied, 0),
    runs = best.runs.map(({ nodes, points }) => ({ nodes, points })),
    orphans = values.flatMap((v, i) =>
      v !== null && !((best.covered | setMask) & (1 << i)) ? [i] : [],
    );
  const runPoints = best.points,
    longestRun = best.longest,
    runBonus = bonus(longestRun),
    setBonus = bonus(longestSet),
    subtotal = runPoints + setPoints + runBonus + setBonus,
    penalty = -3 * orphans.length;
  return {
    runs,
    sets,
    orphans,
    longestRun,
    longestSet,
    runBonus,
    setBonus,
    runPoints,
    setPoints,
    subtotal,
    penalty,
    total: subtotal + penalty,
  };
}
