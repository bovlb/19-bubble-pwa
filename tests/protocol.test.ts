import { it, expect } from "vitest";
import {
  adjectives,
  nouns,
  codeFor,
  generateChallenge,
  parseChallenge,
  Stream,
  hash,
  offsets,
} from "../src/engine/protocol";
import {
  applyMove,
  legalNodes,
  operations,
  replay,
  result,
  roll,
  values,
  type State,
} from "../src/engine/rules";
import { score } from "../src/engine/score";
import golden from "./golden.json";
import adjectiveText from "../src/dictionaries/adjectives.txt?raw";
import nounText from "../src/dictionaries/nouns.txt?raw";
it("matches Python golden vectors, dictionaries, histories and independent final scores", async () => {
  for (const [name, text] of [
    ["adjectives.txt", adjectiveText],
    ["nouns.txt", nounText],
  ])
    expect(
      Array.from(await hash(text), (b) => b.toString(16).padStart(2, "0")).join(
        "",
      ),
    ).toBe(golden.digests[name as keyof typeof golden.digests]);
  for (const vector of golden.vectors) {
    const c = await generateChallenge(vector.code);
    expect(c).toEqual({
      code: vector.code,
      coordinates: vector.coordinates,
      edges: vector.edges,
      dice: vector.dice,
    });
    const s = replay(c, vector.moves as Parameters<typeof replay>[1]);
    expect(score(c, values(c, s)).total).toBe(vector.total);
  }
});
it("checks 1000 codes for induced edges, connectivity, ranges, normalization, repeatability", async () => {
  for (let k = 0; k < 1000; k++) {
    const code = await codeFor(adjectives[k % 32], nouns[Math.floor(k / 32)]),
      c = await generateChallenge(code);
    expect(new Set(c.coordinates.map((p) => p.join(","))).size).toBe(19);
    expect(Math.min(...c.coordinates.map((p) => p[0]))).toBe(0);
    expect(Math.min(...c.coordinates.map((p) => p[1]))).toBe(0);
    for (let i = 0; i < 19; i++)
      for (let j = i + 1; j < 19; j++) {
        const expected = offsets.some(
          ([q, r]) =>
            c.coordinates[j][0] - c.coordinates[i][0] === q &&
            c.coordinates[j][1] - c.coordinates[i][1] === r,
        );
        expect(c.edges.some(([a, b]) => a === i && b === j)).toBe(expected);
      }
    let s: State = { moves: [], revealed: false };
    for (let i = 0; i < 19; i++) {
      const nodes = legalNodes(c, s);
      expect(nodes.length).toBeGreaterThan(0);
      s = applyMove(c, roll(s), {
        nodeId: nodes[0],
        operation: operations[i % 5],
      });
      expect(values(c, s).filter((v) => v !== null).length).toBe(i + 1);
    }
    expect(
      operations
        .map((o) => s.moves.filter((m) => m.operation === o).length)
        .sort(),
    ).toEqual([3, 4, 4, 4, 4]);
    for (const [a, b] of c.dice) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(6);
      expect(b).toBeGreaterThan(0);
      expect(b).toBeLessThan(7);
    }
    if (k < 10) expect(await generateChallenge(code)).toEqual(c);
  }
}, 30000);
it("arithmetic and phase guards", async () => {
  for (let a = 0; a < 6; a++)
    for (let b = 1; b <= 6; b++)
      expect(operations.map((o) => result(o, a, b))).toEqual([
        a + b,
        Math.abs(a - b),
        a * b,
        Math.min(a, b),
        Math.max(a, b),
      ]);
  const c = await generateChallenge(golden.vectors[0].code);
  let s: State = { moves: [], revealed: false };
  expect(legalNodes(c, s)).toHaveLength(19);
  expect(() => applyMove(c, s, { nodeId: 0, operation: "add" })).toThrow();
  s = roll(s);
  expect(() => roll(s)).toThrow();
  s = applyMove(c, s, { nodeId: 0, operation: "add" });
  expect(() => applyMove(c, s, { nodeId: 1, operation: "add" })).toThrow();
  expect(() =>
    applyMove(c, roll(s), { nodeId: 0, operation: "add" }),
  ).toThrow();
  for (let i = 1; i < 4; i++)
    s = applyMove(c, roll(s), {
      nodeId: legalNodes(c, s)[0],
      operation: "add",
    });
  expect(() =>
    applyMove(c, roll(s), { nodeId: legalNodes(c, s)[0], operation: "add" }),
  ).toThrow();
});
it("parsing, correction and stream separation", async () => {
  const code = await codeFor("amber", "badger");
  expect(
    (await parseChallenge(code.toUpperCase().replaceAll("-", " "))).codes,
  ).toEqual([code]);
  expect((await parseChallenge(code.slice(3))).codes).toEqual([code]);
  expect((await parseChallenge(code.replace("amber", "ambr"))).corrected).toBe(
    true,
  );
  await expect(parseChallenge(code.replace("v1", "v2"))).rejects.toThrow(
    "version",
  );
  await expect(parseChallenge("amber-badger")).rejects.toThrow();
  const key = "v1:amber:badger",
    a = new Stream("dice", key),
    b = new Stream("dice", key),
    g = new Stream("graph", key);
  for (let i = 0; i < 100; i++) await g.draw(37);
  for (let i = 0; i < 38; i++) expect(await a.draw(6)).toBe(await b.draw(6));
});
it("preserves checksum collisions as explicit choices and handles leading zeros", async () => {
  const dictionary = Array.from(
      { length: 26 },
      (_, i) => String.fromCharCode(97 + i) + "at",
    ),
    buckets = new Map<string, string[]>();
  for (const a of dictionary) {
    const code = await codeFor(a, "owl"),
      dd = code.slice(-2);
    buckets.set(dd, [...(buckets.get(dd) ?? []), code]);
  }
  const collision = [...buckets].find(([, c]) => c.length > 1);
  expect(collision).toBeDefined();
  const parsed = await parseChallenge(`?at-owl-${collision![0]}`, {
    adjectives: dictionary,
    nouns: ["owl"],
  });
  expect(parsed.codes).toEqual(collision![1]);
  const code = await codeFor("amber", "badger");
  await expect(
    parseChallenge(
      code.slice(0, -2) +
        String((Number(code.slice(-2)) + 1) % 100).padStart(2, "0"),
    ),
  ).rejects.toThrow("Check digits");
  let zero = "";
  for (const a of adjectives) {
    for (const n of nouns) {
      const c = await codeFor(a, n);
      if (c.endsWith("-00")) {
        zero = c;
        break;
      }
    }
    if (zero) break;
  }
  expect(zero).not.toBe("");
  expect((await parseChallenge(zero)).codes).toEqual([zero]);
});
it("rejects nonfrontier, incomplete, and completed moves without mutation", async () => {
  const c = await generateChallenge(golden.vectors[0].code);
  let s: State = { moves: [], revealed: false };
  s = applyMove(c, roll(s), { nodeId: 0, operation: "add" });
  const choosing = roll(s),
    before = JSON.stringify(choosing),
    nonfrontier = c.coordinates.findIndex(
      (_, i) => i !== 0 && !legalNodes(c, s).includes(i),
    );
  expect(nonfrontier).toBeGreaterThan(0);
  expect(() =>
    applyMove(c, choosing, { nodeId: nonfrontier, operation: "min" }),
  ).toThrow();
  expect(() =>
    applyMove(c, choosing, { nodeId: legalNodes(c, s)[0] } as never),
  ).toThrow();
  expect(JSON.stringify(choosing)).toBe(before);
  const done = replay(
    c,
    golden.vectors[0].moves as Parameters<typeof replay>[1],
  );
  expect(() => roll(done)).toThrow();
  expect(() =>
    applyMove(c, { ...done, revealed: true }, { nodeId: 0, operation: "add" }),
  ).toThrow();
});
