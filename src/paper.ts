import type { Graph } from "./engine/rules";
export type Point = [number, number];
const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const offsets = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, -1],
  [-1, 1],
];
export function paperGraph(points: Point[]): Graph {
  const edges: [number, number][] = [];
  points.forEach(([q, r], a) =>
    points.forEach(([s, t], b) => {
      if (a < b && offsets.some(([dq, dr]) => s - q === dq && t - r === dr))
        edges.push([a, b]);
    }),
  );
  return { coordinates: points, edges };
}
export function normalizeShape(points: Point[]): Point[] {
  if (
    !Array.isArray(points) ||
    points.length !== 19 ||
    points.some(
      (p) =>
        !Array.isArray(p) ||
        p.length !== 2 ||
        p.some((x) => !Number.isInteger(x) || Math.abs(x) > 36),
    )
  )
    throw Error("Select exactly 19 bubbles.");
  const q = Math.min(...points.map((p) => p[0])),
    r = Math.min(...points.map((p) => p[1]));
  const normalized = points
    .map(([x, y]): Point => [x - q, y - r])
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  if (new Set(normalized.map((p) => p.join(","))).size !== 19)
    throw Error("Board positions must be unique.");
  const edges = paperGraph(normalized).edges,
    seen = new Set([0]);
  for (let i = 0; i < 19; i++)
    for (const [a, b] of edges) {
      if (seen.has(a)) seen.add(b);
      if (seen.has(b)) seen.add(a);
    }
  if (seen.size !== 19) throw Error("Connect all 19 bubbles into one board.");
  return normalized;
}
function checksum(text: string) {
  let hash = 2166136261;
  for (const char of text)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
export function encodeShape(points: Point[]) {
  const body =
    "1." +
    normalizeShape(points)
      .map(([q, r]) => alphabet[q] + alphabet[r])
      .join("");
  return body + "." + checksum(body);
}
export function decodeShape(token: string): Point[] {
  if (!/^1\.[A-Za-z0-9_-]{38}\.[a-f0-9]{8}$/.test(token))
    throw Error(
      "This board link is incomplete or unsupported. Ask the sender to share it again.",
    );
  const [version, data, check] = token.split(".");
  if (checksum(version + "." + data) !== check)
    throw Error(
      "This board link was changed or cut short. Ask the sender to share it again.",
    );
  const points: Point[] = Array.from({ length: 19 }, (_, i) => [
    alphabet.indexOf(data[i * 2]),
    alphabet.indexOf(data[i * 2 + 1]),
  ]);
  return normalizeShape(points);
}
export function validateGraph(graph: Graph): Graph {
  if (!graph || !Array.isArray(graph.coordinates) || graph.coordinates.length !== 19 ||
      !Array.isArray(graph.edges) || graph.edges.length < 18 || graph.edges.length > 57)
    throw Error("A board needs 19 connected bubbles.");
  const coordinates = graph.coordinates.map((p) => {
    if (!Array.isArray(p) || p.length !== 2 || p.some((v) => !Number.isInteger(v) || v < 0 || v > 1000))
      throw Error("Invalid bubble position.");
    return [p[0], p[1]] as Point;
  });
  if (new Set(coordinates.map((p) => p.join(","))).size !== 19)
    throw Error("Bubble positions must be unique.");
  const edges = graph.edges.map((e) => {
    if (!Array.isArray(e) || e.length !== 2 || !Number.isInteger(e[0]) || !Number.isInteger(e[1]) || e[0] < 0 || e[0] >= e[1] || e[1] >= 19)
      throw Error("Invalid bubble connection.");
    return [e[0], e[1]] as [number, number];
  });
  if (new Set(edges.map((e) => e.join(","))).size !== edges.length)
    throw Error("Duplicate bubble connection.");
  const seen = new Set([0]);
  for (let i = 0; i < 19; i++) for (const [a, b] of edges) {
    if (seen.has(a)) seen.add(b);
    if (seen.has(b)) seen.add(a);
  }
  if (seen.size !== 19) throw Error("Connect all 19 bubbles.");
  return { coordinates, edges };
}
export function encodeGraphShape(graph: Graph): string {
  const checked = validateGraph(graph);
  const payload = JSON.stringify([checked.coordinates, checked.edges]);
  const body = "2." + btoa(String.fromCharCode(...new TextEncoder().encode(payload)))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return body + "." + checksum(body);
}
export function decodePaperGraph(token: string): Graph {
  if (token.startsWith("1.")) return paperGraph(decodeShape(token));
  if (!/^2\.[A-Za-z0-9_-]{1,2000}\.[a-f0-9]{8}$/.test(token))
    throw Error("This board link is incomplete or unsupported.");
  const [version, data, check] = token.split(".");
  if (checksum(version + "." + data) !== check) throw Error("This board link was changed or cut short.");
  try {
    const raw = atob(data.replaceAll("-", "+").replaceAll("_", "/"));
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(raw, c => c.charCodeAt(0))));
    if (!Array.isArray(parsed) || parsed.length !== 2) throw Error();
    return validateGraph({ coordinates: parsed[0], edges: parsed[1] });
  } catch { throw Error("Invalid board graph in link."); }
}
export function encodeShapeName(name: string) {
  return btoa(
    String.fromCharCode(...new TextEncoder().encode(name.trim().slice(0, 80))),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
export function readShapeRoute(route: string) {
  const parts = route.split("/");
  if (parts.length > 2)
    throw Error("Invalid board link. Ask the sender to share it again.");
  const token = parts[0];
  const graph = decodePaperGraph(token);
  const points = token.startsWith("1.") ? graph.coordinates : [];
  let name = "";
  if (parts.length === 2) {
    if (!/^[A-Za-z0-9_-]{1,430}$/.test(parts[1]))
      throw Error("Invalid board name in link.");
    try {
      const bytes = Uint8Array.from(
        atob(parts[1].replaceAll("-", "+").replaceAll("_", "/")),
        (c) => c.charCodeAt(0),
      );
      name = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (name.length > 80 || encodeShapeName(name) !== parts[1])
        throw Error("Invalid name");
    } catch {
      throw Error("Invalid board name in link.");
    }
  }
  return { token, points, graph, name };
}
export const shapeLink = (token: string, name = "") =>
  `${location.origin}${import.meta.env.BASE_URL}#shape/${token}${name.trim() ? "/" + encodeShapeName(name) : ""}`;
export type PaperDraft = {
  id: string;
  token: string;
  name: string;
  values: (number | null)[];
  updated: number;
};
export const paperStorageKey = "bubble19-paper-v1";
export function readPaperDrafts(): PaperDraft[] {
  const data = JSON.parse(localStorage.getItem(paperStorageKey) ?? "[]");
  if (!Array.isArray(data)) throw Error("Unreadable paper saves");
  for (const d of data) {
    if (
      !d ||
      typeof d.id !== "string" ||
      typeof d.token !== "string" ||
      typeof d.name !== "string" ||
      !Number.isFinite(d.updated) ||
      !Array.isArray(d.values) ||
      d.values.length !== 19 ||
      d.values.some(
        (v: unknown) =>
          v !== null &&
          (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 30),
      )
    )
      throw Error("Unreadable paper saves");
    decodePaperGraph(d.token);
  }
  return data;
}
