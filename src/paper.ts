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
  const points = decodeShape(token);
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
  return { token, points, name };
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
    decodeShape(d.token);
  }
  return data;
}
