import { describe, it, expect } from "vitest";
import {
  decodeShape,
  decodePaperGraph,
  encodeGraphShape,
  encodeShapeName,
  readShapeRoute,
  encodeShape,
  normalizeShape,
  paperGraph,
  type Point,
} from "../src/paper";
import { score } from "../src/engine/score";
const points: Point[] = Array.from({ length: 19 }, (_, i) => [
  (i % 7) - Math.floor(Math.floor(i / 7) / 2),
  Math.floor(i / 7),
]);
describe("paper board shapes", () => {
  it("round trips normalized geometry in a compact link token without equals signs", () => {
    const token = encodeShape(points);
    expect(token).toMatch(/^1\.[A-Za-z0-9_-]{38}\.[a-f0-9]{8}$/);
    expect(token).not.toContain("=");
    expect(decodeShape(token)).toEqual(normalizeShape(points));
    expect(
      encodeShape(
        points
          .slice()
          .reverse()
          .map(([q, r]) => [q + 2, r - 3]),
      ),
    ).toBe(token);
  });
  it("rejects truncated, modified, unsupported, duplicate, or disconnected shapes", () => {
    const token = encodeShape(points);
    for (const invalid of [
      token.slice(0, -1),
      token + "=",
      token.replace("1.", "2."),
      token.slice(0, -1) + (token.endsWith("0") ? "1" : "0"),
    ])
      expect(() => decodeShape(invalid)).toThrow();
    expect(() => encodeShape(points.slice(1))).toThrow();
    expect(() => encodeShape([...points.slice(1), points[1]])).toThrow();
    expect(() => encodeShape([...points.slice(1), [30, 30]])).toThrow();
  });
  it("connects all six lattice neighbors but not distant positions", () => {
    const graph = paperGraph([
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, -1],
      [-1, 1],
      [2, 0],
    ]);
    expect(graph.edges.filter(([a]) => a === 0)).toEqual([
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
      [0, 5],
      [0, 6],
    ]);
  });
  it("scores typed values independently of dice history and distinguishes zero from empty", () => {
    const graph = paperGraph(normalizeShape(points));
    expect(score(graph, Array(19).fill(5)).total).toBe(98);
    expect(score(graph, Array(19).fill(null)).total).toBe(0);
    expect(score(graph, [0, ...Array(18).fill(null)]).total).toBe(-3);
  });
});

it("shares optional Unicode names without equals signs or number data", () => {
  const token = encodeShape(points),
    name = "Sunday = café 🐝";
  const route = token + "/" + encodeShapeName(name);
  expect(route).not.toContain("=");
  expect(readShapeRoute(route)).toEqual({
    token,
    points: normalizeShape(points),
    graph: paperGraph(normalizeShape(points)),
    name,
  });
  expect(readShapeRoute(token).name).toBe("");
  expect(() => readShapeRoute(token + "/%%%")).toThrow();
  expect(() => readShapeRoute(token + "/QQ/extra")).toThrow();
});

it("shares a non-lattice explicit graph and keeps old shape links readable", () => {
  const graph = {
    coordinates: Array.from({ length: 19 }, (_, i) => [i * 50, i % 2 * 20] as Point),
    edges: Array.from({ length: 18 }, (_, i) => [i, i + 1] as [number, number]),
  };
  const token = encodeGraphShape(graph);
  expect(decodePaperGraph(token)).toEqual(graph);
  expect(readShapeRoute(token).graph).toEqual(graph);
  expect(decodePaperGraph(encodeShape(points))).toEqual(paperGraph(normalizeShape(points)));
  expect(() => decodePaperGraph(token.slice(0, -1) + "a")).toThrow();
});
