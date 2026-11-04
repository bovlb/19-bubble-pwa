import { encodeShape, normalizeShape, paperGraph, type Point } from "./paper";

export type CameraCircle = {
  id: string;
  x: number;
  y: number;
  radius: number;
  q: number | null;
  r: number | null;
  value: number | null;
  detectionConfidence: number;
  ocrStatus: "read" | "uncertain" | "unreadable";
};
export type CameraProposal = {
  schema: 1;
  status: "review" | "partial";
  image: { width: number; height: number };
  circles: CameraCircle[];
  edges: [number, number][];
  warnings: string[];
};

const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const whole = (x: unknown): x is number => Number.isInteger(x);
const value = (x: unknown): x is number | null =>
  x === null || (whole(x) && x >= 0 && x <= 30);

export function validateCameraProposal(data: unknown): CameraProposal {
  if (!object(data) || data.schema !== 1 || !object(data.image))
    throw Error("Camera service returned an unsupported response.");
  const { width, height } = data.image;
  if (
    !whole(width) ||
    !whole(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 30_000_000 ||
    (data.status !== "review" && data.status !== "partial") ||
    !Array.isArray(data.circles) ||
    data.circles.length > 80 ||
    !Array.isArray(data.edges) ||
    !Array.isArray(data.warnings) ||
    data.warnings.some((w) => typeof w !== "string" || w.length > 250)
  )
    throw Error("Camera service returned an invalid board.");
  const circles: CameraCircle[] = [];
  const ids = new Set<string>();
  const positions = new Set<string>();
  for (const raw of data.circles) {
    if (!object(raw)) throw Error("Camera service returned an invalid circle.");
    const { id, x, y, radius, q, r, detectionConfidence, ocrStatus } = raw;
    if (
      typeof id !== "string" ||
      !/^c\d{1,2}$/.test(id) ||
      ids.has(id) ||
      typeof x !== "number" ||
      typeof y !== "number" ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      y < 0 ||
      x > width ||
      y > height ||
      typeof radius !== "number" ||
      !Number.isFinite(radius) ||
      radius <= 0 ||
      radius > Math.max(width, height) / 2 ||
      (q === null) !== (r === null) ||
      (q !== null &&
        (!whole(q) || !whole(r) || Math.abs(q) > 36 || Math.abs(r) > 36)) ||
      !value(raw.value) ||
      typeof detectionConfidence !== "number" ||
      !Number.isFinite(detectionConfidence) ||
      detectionConfidence < 0 ||
      detectionConfidence > 1 ||
      !["read", "uncertain", "unreadable"].includes(String(ocrStatus))
    )
      throw Error("Camera service returned an invalid circle.");
    ids.add(id);
    if (q !== null) {
      const key = `${q},${r}`;
      if (positions.has(key))
        throw Error("Camera service returned duplicate board positions.");
      positions.add(key);
    }
    circles.push(raw as CameraCircle);
  }
  const edges: [number, number][] = [];
  for (const edge of data.edges) {
    if (
      !Array.isArray(edge) ||
      edge.length !== 2 ||
      !whole(edge[0]) ||
      !whole(edge[1]) ||
      edge[0] < 0 ||
      edge[0] >= edge[1] ||
      edge[1] >= circles.length
    )
      throw Error("Camera service returned invalid connections.");
    edges.push(edge as [number, number]);
  }
  if (new Set(edges.map((e) => e.join(","))).size !== edges.length)
    throw Error("Camera service returned duplicate connections.");
  if (data.status === "review") {
    if (circles.length !== 19 || circles.some((c) => c.q === null))
      throw Error("Camera service returned an incomplete board.");
    const expected = paperGraph(circles.map((c) => [c.q!, c.r!])).edges;
    if (JSON.stringify(expected) !== JSON.stringify(edges))
      throw Error("Camera service returned inconsistent connections.");
    normalizeShape(circles.map((c) => [c.q!, c.r!]));
  }
  return data as CameraProposal;
}

export function cameraToPaper(circles: CameraCircle[]): {
  points: Point[];
  values: (number | null)[];
  token: string;
} {
  if (
    circles.length !== 19 ||
    circles.some((c) => c.q === null || c.r === null)
  )
    throw Error("Place exactly 19 bubbles on the grid.");
  const sorted = [...circles].sort((a, b) => a.r! - b.r! || a.q! - b.q!);
  const points = normalizeShape(sorted.map((c) => [c.q!, c.r!]));
  const values = sorted.map((c) => c.value);
  if (!values.every(value)) throw Error("Check the bubble values.");
  return { points, values, token: encodeShape(points) };
}

export function cameraEdges(circles: CameraCircle[]): [number, number][] {
  const placed = circles
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.q !== null && c.r !== null);
  return paperGraph(placed.map(({ c }) => [c.q!, c.r!])).edges.map(([a, b]) => [
    placed[a].i,
    placed[b].i,
  ]);
}
