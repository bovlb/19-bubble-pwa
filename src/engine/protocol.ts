import adjectivesText from "../dictionaries/adjectives.txt?raw";
import nounsText from "../dictionaries/nouns.txt?raw";
import type { Challenge } from "./rules";
export const adjectives = adjectivesText.trim().split("\n"),
  nouns = nounsText.trim().split("\n");
export async function hash(text: string) {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
}
export async function codeFor(a: string, n: string) {
  const bytes = await hash("bubble19:check:v1:" + a + ":" + n);
  let remainder = 0;
  for (const byte of bytes) remainder = (remainder * 256 + byte) % 100;
  return `v1-${a}-${n}-${String(remainder).padStart(2, "0")}`;
}
function distanceOne(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0,
    j = 0,
    edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else {
      if (++edits > 1) return false;
      if (a.length >= b.length) i++;
      if (b.length >= a.length) j++;
    }
  }
  return edits + a.length - i + b.length - j <= 1;
}
export type Parsed = { codes: string[]; corrected: boolean };
export async function parseChallenge(
  input: string,
  lists = { adjectives, nouns },
): Promise<Parsed> {
  let text = input.trim();
  if (text.includes("#")) {
    const url = new URL(text);
    if (!url.hash.startsWith("#challenge="))
      throw Error("Expected a challenge link");
    text = decodeURIComponent(url.hash.slice(11));
  }
  const parts = text.replace(/[A-Z]/g, (c) => c.toLowerCase()).split(/[ -]+/);
  if (parts[0]?.match(/^v\d+$/)) {
    if (parts.shift() !== "v1") throw Error("Unsupported challenge version");
  }
  if (parts.length !== 3 || !/^\d{2}$/.test(parts[2]))
    throw Error("Enter adjective, noun, and exactly two check digits");
  const [a, n, dd] = parts;
  const aa = lists.adjectives.includes(a)
      ? [a]
      : lists.adjectives.filter((w) => distanceOne(a, w)),
    nn = lists.nouns.includes(n)
      ? [n]
      : lists.nouns.filter((w) => distanceOne(n, w));
  const codes: string[] = [];
  for (const x of aa)
    for (const y of nn) {
      const code = await codeFor(x, y);
      if (code.endsWith("-" + dd)) codes.push(code);
    }
  if (!codes.length)
    throw Error(
      lists.adjectives.includes(a) && lists.nouns.includes(n)
        ? "Check digits do not match these words"
        : "No matching challenge; check the words and digits",
    );
  return {
    codes,
    corrected: !lists.adjectives.includes(a) || !lists.nouns.includes(n),
  };
}
export class Stream {
  private counter = 0;
  private bytes = new Uint8Array(0);
  private cursor = 0;
  constructor(
    private domain: string,
    private key: string,
  ) {}
  async draw(m: number): Promise<number> {
    if (!Number.isInteger(m) || m < 1 || m > 2 ** 32)
      throw Error("Invalid draw bound");
    const limit = Math.floor(2 ** 32 / m) * m;
    for (;;) {
      if (this.cursor === this.bytes.length) {
        this.bytes = await hash(
          `bubble19:${this.domain}:${this.key}:${this.counter++}`,
        );
        this.cursor = 0;
      }
      let x = 0;
      for (let i = 0; i < 4; i++) x = x * 256 + this.bytes[this.cursor++];
      if (x < limit) return x % m;
    }
  }
}
export const offsets: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
];
export async function generateChallenge(code: string): Promise<Challenge> {
  const parsed = await parseChallenge(code);
  if (parsed.codes.length !== 1 || parsed.corrected || parsed.codes[0] !== code)
    throw Error("Canonical challenge required");
  const [, a, n] = code.split("-"),
    key = `v1:${a}:${n}`,
    graph = new Stream("graph", key),
    diceStream = new Stream("dice", key);
  let coordinates: [number, number][] = [[0, 0]];
  const occupied = new Set(["0,0"]);
  while (coordinates.length < 19) {
    const frontier = new Map<string, [number, number]>();
    for (const [q, r] of coordinates)
      for (const [dq, dr] of offsets) {
        const p: [number, number] = [q + dq, r + dr];
        if (!occupied.has(p.join(","))) frontier.set(p.join(","), p);
      }
    const candidates = [...frontier.values()].sort(
        ([q, r], [s, t]) => q - s || r - t,
      ),
      weights = candidates.map(
        ([q, r]) =>
          offsets.filter(([dq, dr]) => occupied.has([q + dq, r + dr].join(",")))
            .length ** 2,
      );
    let draw = await graph.draw(weights.reduce((a, b) => a + b, 0)),
      chosen = 0;
    while (draw >= weights[chosen]) draw -= weights[chosen++];
    const p = candidates[chosen];
    coordinates.push(p);
    occupied.add(p.join(","));
  }
  const minQ = Math.min(...coordinates.map((p) => p[0])),
    minR = Math.min(...coordinates.map((p) => p[1]));
  coordinates = coordinates
    .map(([q, r]) => [q - minQ, r - minR] as [number, number])
    .sort(([q, r], [s, t]) => q - s || r - t);
  const edges: [number, number][] = [];
  coordinates.forEach(([q, r], i) =>
    coordinates.forEach(([s, t], j) => {
      if (i < j && offsets.some(([dq, dr]) => s - q === dq && t - r === dr))
        edges.push([i, j]);
    }),
  );
  const dice: [number, number][] = [];
  for (let i = 0; i < 19; i++)
    dice.push([await diceStream.draw(6), 1 + (await diceStream.draw(6))]);
  return { code, coordinates, edges, dice };
}
function randomBelow(m: number) {
  const b = new Uint32Array(1),
    limit = Math.floor(2 ** 32 / m) * m;
  do {
    crypto.getRandomValues(b);
  } while (b[0] >= limit);
  return b[0] % m;
}
export const randomCode = () =>
  codeFor(
    adjectives[randomBelow(adjectives.length)],
    nouns[randomBelow(nouns.length)],
  );
