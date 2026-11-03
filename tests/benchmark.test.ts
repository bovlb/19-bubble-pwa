import { it, expect } from "vitest";
import {
  generateChallenge,
  codeFor,
  adjectives,
  nouns,
} from "../src/engine/protocol";
import { score } from "../src/engine/score";
it("benchmarks 1000 generated/value-rich boards plus adversarial chains", async () => {
  const samples: number[] = [];
  let seed = 98765;
  const random = (n: number) => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) % n;
  };
  for (let i = 0; i < 1000; i++) {
    const c = await generateChallenge(
      await codeFor(adjectives[i % 32], nouns[Math.floor(i / 32)]),
    );
    const v = c.coordinates.map(([q, r]) =>
      i % 3 === 0 ? q + r : i % 3 === 1 ? random(10) : random(31),
    );
    const start = performance.now();
    const s = score(c, v);
    samples.push(performance.now() - start);
    expect(Number.isFinite(s.total)).toBe(true);
  }
  const chain = {
    coordinates: Array.from(
      { length: 19 },
      (_, i) => [i, 0] as [number, number],
    ),
    edges: Array.from({ length: 18 }, (_, i) => [i, i + 1] as [number, number]),
  };
  const start = performance.now();
  score(
    chain,
    Array.from({ length: 19 }, (_, i) => i),
  );
  const adversarial = performance.now() - start;
  samples.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      boards: 1000,
      p95ms: samples[949],
      maxMs: samples[999],
      chainMs: adversarial,
      runtime: navigator.userAgent,
    }),
  );
}, 60000);
