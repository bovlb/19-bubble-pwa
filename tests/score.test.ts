import { describe, it, expect } from "vitest";
import { score, bonus } from "../src/engine/score";
import type { Graph } from "../src/engine/rules";
const graph = (n: number, edges: [number, number][]): Graph => ({
  coordinates: Array.from({ length: n }, (_, i) => [i, 0]),
  edges,
});
const chain = (n: number) =>
  graph(
    n,
    Array.from({ length: Math.max(0, n - 1) }, (_, i) => [i, i + 1]),
  );
// Independent oracle: direct subset enumeration, no production scoring helpers.
function oracle(g: Graph, v: (number | null)[]) {
  const adjacent = (a: number, b: number) =>
    g.edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  const b = (n: number) =>
    [0, 0, 0, 1, 3, 6, 10, 15, 20, 25][n] ?? 25 + 5 * (n - 9);
  const components: number[][] = [],
    visited = new Set<number>();
  for (let i = 0; i < v.length; i++)
    if (v[i] !== null && !visited.has(i)) {
      const c = [i];
      visited.add(i);
      for (let k = 0; k < c.length; k++)
        for (let j = 0; j < v.length; j++)
          if (!visited.has(j) && v[j] === v[i] && adjacent(c[k], j)) {
            c.push(j);
            visited.add(j);
          }
      if (c.length > 1) components.push(c);
    }
  const paths: number[][] = [];
  function visit(p: number[]) {
    if (p.length > 1) paths.push(p);
    for (let j = 0; j < v.length; j++)
      if (v[j] !== null && v[j] === v[p.at(-1)!]! + 1 && adjacent(p.at(-1)!, j))
        visit([...p, j]);
  }
  v.forEach((x, i) => {
    if (x !== null) visit([i]);
  });
  const fixed =
    components.reduce((s, c) => s + v[c[0]]! + c.length - 1, 0) +
    b(Math.max(0, ...components.map((c) => c.length)));
  let best = -Infinity;
  function subsets(
    i: number,
    used: Set<number>,
    points: number,
    longest: number,
  ) {
    if (i === paths.length) {
      const covered = new Set([...used, ...components.flat()]);
      best = Math.max(
        best,
        fixed +
          points +
          b(longest) -
          3 * v.filter((x, j) => x !== null && !covered.has(j)).length,
      );
      return;
    }
    subsets(i + 1, used, points, longest);
    const p = paths[i];
    if (p.every((j) => !used.has(j)))
      subsets(
        i + 1,
        new Set([...used, ...p]),
        points + v[p.at(-1)!]! + p.length - 1,
        Math.max(longest, p.length),
      );
  }
  subsets(0, new Set(), 0, 0);
  return best;
}
describe("exact scorer", () => {
  it("hand-calculated chains", () => {
    for (const [v, total] of [
      [[], 0],
      [[7], -3],
      [[1, 2], 3],
      [[0, 1, 2], 5],
      [[1, 3], -6],
      [[0, 0], 1],
      [[5, 5, 5], 8],
      [[1, 2, 2], 6],
      [[1, 2, 3, 4], 10],
    ] as [number[], number][])
      expect(score(chain(v.length), v).total).toBe(total);
  });
  it("coverage-sensitive optimum", () => {
    const g = graph(5, [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4],
        [1, 3],
      ]),
      v = [9, 10, 11, 10, 9];
    expect(oracle(g, v)).toBe(36);
    expect(score(g, v).total).toBe(36);
  });
  it("bonuses and merging sets", () => {
    expect(Array.from({ length: 20 }, (_, i) => bonus(i))).toEqual([
      0, 0, 0, 1, 3, 6, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75,
    ]);
    expect(score(chain(5), [30, 30, null, 30, 30]).subtotal).toBe(62);
    expect(score(chain(5), [30, 30, 30, 30, 30]).subtotal).toBe(40);
  });
  it("agrees with independent exhaustive subsets for 1000 seeded graphs", () => {
    let seed = 123456;
    const rand = (n: number) => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) % n;
    };
    for (let k = 0; k < 1000; k++) {
      const n = 1 + rand(8),
        edges: [number, number][] = [];
      for (let a = 0; a < n; a++)
        for (let b = a + 1; b < n; b++) if (rand(4) === 0) edges.push([a, b]);
      const g = graph(n, edges),
        v = Array.from({ length: n }, () => rand(6));
      const s = score(g, v);
      expect(s.total).toBe(oracle(g, v));
      expect(s.subtotal + s.penalty).toBe(s.total);
      const used = s.runs.flatMap((r) => r.nodes);
      expect(new Set(used).size).toBe(used.length);
      for (const r of s.runs)
        for (let j = 1; j < r.nodes.length; j++)
          expect(v[r.nodes[j]] - v[r.nodes[j - 1]]).toBe(1);
    }
  });
});
it("star, disconnected groups, long paths and stable symmetric tie-break", () => {
  expect(
    score(
      graph(4, [
        [0, 1],
        [0, 2],
        [0, 3],
      ]),
      [2, 1, 3, 3],
    ).total,
  ).toBe(3);
  expect(
    score(
      graph(6, [
        [0, 1],
        [1, 2],
        [3, 4],
        [4, 5],
      ]),
      [1, 2, 3, 5, 6, 7],
    ).total,
  ).toBe(15);
  expect(
    score(
      graph(6, [
        [0, 1],
        [1, 2],
        [3, 4],
        [4, 5],
      ]),
      [4, 4, 4, 7, 7, 7],
    ).total,
  ).toBe(16);
  expect(score(chain(10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).total).toBe(
    oracle(chain(10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
  );
  const g = graph(3, [
    [0, 1],
    [0, 2],
  ]);
  expect(score(g, [1, 2, 2]).runs[0].nodes).toEqual([0, 1]);
  expect(score({ ...g, edges: [...g.edges].reverse() }, [1, 2, 2])).toEqual(
    score(g, [1, 2, 2]),
  );
});
import regressions from "./regressions.json";
it("retains independently discovered greedy, maximal-only, and subtotal-only failures", () => {
  expect(Object.keys(regressions)).toHaveLength(4);
  for (const fixture of Object.values(regressions)) {
    const g = graph(fixture.values.length, fixture.edges as [number, number][]);
    expect(oracle(g, fixture.values)).toBe(fixture.total);
    expect(score(g, fixture.values).total).toBe(fixture.total);
  }
});
function verifyCertificate(g: Graph, v: (number | null)[]) {
  const s = score(g, v),
    used = new Set<number>();
  for (const r of s.runs) {
    expect(r.nodes.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < r.nodes.length; i++) {
      const a = r.nodes[i];
      expect(used.has(a)).toBe(false);
      used.add(a);
      if (i) {
        const b = r.nodes[i - 1];
        expect(
          g.edges.some(
            ([x, y]) => (x === a && y === b) || (x === b && y === a),
          ),
        ).toBe(true);
        expect(v[a]).toBe(v[b]! + 1);
      }
    }
    expect(r.points).toBe(v[r.nodes.at(-1)!]! + r.nodes.length - 1);
  }
  const setNodes = new Set<number>();
  for (const set of s.sets) {
    expect(set.nodes.length).toBeGreaterThanOrEqual(2);
    const component = new Set([set.nodes[0]]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [a, b] of g.edges)
        if (
          v[a] === v[set.nodes[0]] &&
          v[b] === v[a] &&
          (component.has(a) || component.has(b))
        ) {
          if (!component.has(a) || !component.has(b)) changed = true;
          component.add(a);
          component.add(b);
        }
    }
    expect([...component].sort((a, b) => a - b)).toEqual(set.nodes);
    for (const i of set.nodes) {
      expect(setNodes.has(i)).toBe(false);
      setNodes.add(i);
    }
    expect(set.points).toBe(v[set.nodes[0]]! + set.nodes.length - 1);
  }
  expect(s.orphans).toEqual(
    v.flatMap((x, i) =>
      x !== null && !used.has(i) && !setNodes.has(i) ? [i] : [],
    ),
  );
  expect(s.longestRun).toBe(Math.max(0, ...s.runs.map((r) => r.nodes.length)));
  expect(s.longestSet).toBe(Math.max(0, ...s.sets.map((r) => r.nodes.length)));
  expect(s.runPoints).toBe(s.runs.reduce((a, r) => a + r.points, 0));
  expect(s.setPoints).toBe(s.sets.reduce((a, r) => a + r.points, 0));
  expect(s.subtotal).toBe(
    s.runPoints + s.setPoints + bonus(s.longestRun) + bonus(s.longestSet),
  );
  expect(s.total).toBe(s.subtotal - 3 * s.orphans.length);
}
it("exhaustively checks all four-node graphs and ternary value assignments with certificates", () => {
  const pairs: [number, number][] = [
    [0, 1],
    [0, 2],
    [0, 3],
    [1, 2],
    [1, 3],
    [2, 3],
  ];
  for (let mask = 0; mask < 64; mask++)
    for (let assignment = 0; assignment < 81; assignment++) {
      let x = assignment;
      const v = Array.from({ length: 4 }, () => {
        const value = x % 3;
        x = Math.floor(x / 3);
        return value;
      });
      const g = graph(
        4,
        pairs.filter((_, i) => mask & (1 << i)),
      );
      expect(score(g, v).total).toBe(oracle(g, v));
      verifyCertificate(g, v);
    }
});
it("returns an entirely zero-valued empty-board certificate", () => {
  expect(score(chain(0), [])).toEqual({
    runs: [],
    sets: [],
    orphans: [],
    longestRun: 0,
    longestSet: 0,
    runBonus: 0,
    setBonus: 0,
    runPoints: 0,
    setPoints: 0,
    subtotal: 0,
    penalty: 0,
    total: 0,
  });
});
