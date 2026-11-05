import { encodeGraphShape, validateGraph } from "./paper";
import type { Graph } from "./engine/rules";

export type CameraCircle = {
  id: string; x: number; y: number; radius: number;
  value: number | null; detectionConfidence: number;
  ocrStatus: "read" | "uncertain" | "unreadable";
};
export type Corner = [number, number];
export type CameraProposal = {
  schema: 2; status: "review" | "partial";
  image: { width: number; height: number };
  boardCorners: [Corner, Corner, Corner, Corner];
  circles: CameraCircle[]; edges: [number, number][];
  warnings: string[];
};
const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const whole = (x: unknown): x is number => Number.isInteger(x);
const validValue = (x: unknown): x is number | null =>
  x === null || (whole(x) && x >= 0 && x <= 30);

function rectifyCircles(circles: CameraCircle[], corners?: Corner[]): CameraCircle[] {
  if (!corners || corners.length !== 4) return circles;
  const [tl, tr, br, bl] = corners;
  const width = Math.max(Math.hypot(tr[0] - tl[0], tr[1] - tl[1]),
    Math.hypot(br[0] - bl[0], br[1] - bl[1]));
  const height = Math.max(Math.hypot(bl[0] - tl[0], bl[1] - tl[1]),
    Math.hypot(br[0] - tr[0], br[1] - tr[1]));
  const dst: Corner[] = [[0, 0], [width, 0], [width, height], [0, height]];
  const rows = corners.map(([x, y], i) => [
    [x, y, 1, 0, 0, 0, -x * dst[i][0], -y * dst[i][0], dst[i][0]],
    [0, 0, 0, x, y, 1, -x * dst[i][1], -y * dst[i][1], dst[i][1]],
  ]).flat();
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    if (Math.abs(rows[pivot][col]) < 1e-8) return circles;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const divisor = rows[col][col];
    for (let j = col; j < 9; j++) rows[col][j] /= divisor;
    for (let row = 0; row < 8; row++) if (row !== col) {
      const factor = rows[row][col];
      for (let j = col; j < 9; j++) rows[row][j] -= factor * rows[col][j];
    }
  }
  const h = rows.map(row => row[8]);
  const project = (x: number, y: number): Corner => {
    const divisor = h[6] * x + h[7] * y + 1;
    return [(h[0] * x + h[1] * y + h[2]) / divisor,
      (h[3] * x + h[4] * y + h[5]) / divisor];
  };
  return circles.map(c => {
    const [x, y] = project(c.x, c.y);
    const [rx, ry] = project(c.x + c.radius, c.y);
    const [sx, sy] = project(c.x, c.y + c.radius);
    return { ...c, x, y, radius: (Math.hypot(rx - x, ry - y) + Math.hypot(sx - x, sy - y)) / 2 };
  });
}

export function cameraEdges(circles: CameraCircle[], corners?: Corner[]): [number, number][] {
  circles = rectifyCircles(circles, corners);
  const edges: [number, number][] = [];
  for (let a = 0; a < circles.length; a++) for (let b = a + 1; b < circles.length; b++) {
    const first = circles[a], second = circles[b];
    const ratio = Math.hypot(first.x - second.x, first.y - second.y) /
      (first.radius + second.radius);
    if (ratio >= 0.72 && ratio <= 1.32) edges.push([a, b]);
  }
  return edges;
}

export function cameraToPaper(circles: CameraCircle[], corners?: Corner[]): {
  graph: Graph; values: (number | null)[]; token: string;
} {
  if (circles.length !== 19) throw Error("Place exactly 19 bubbles.");
  if (circles.some(c => !Number.isFinite(c.x) || !Number.isFinite(c.y) ||
      !Number.isFinite(c.radius) || c.radius <= 0 || !validValue(c.value)))
    throw Error("Check the bubble positions and values.");
  const front = rectifyCircles(circles, corners);
  const minX = Math.min(...front.map(c => c.x)), maxX = Math.max(...front.map(c => c.x));
  const minY = Math.min(...front.map(c => c.y)), maxY = Math.max(...front.map(c => c.y));
  if (maxX === minX || maxY === minY) throw Error("Bubble positions must be distinct.");
  const graph = validateGraph({
    coordinates: front.map(c => [Math.round((c.x - minX) * 1000 / (maxX - minX)),
      Math.round((c.y - minY) * 1000 / (maxY - minY))]),
    edges: cameraEdges(circles, corners),
  });
  return { graph, values: circles.map(c => c.value), token: encodeGraphShape(graph) };
}

export function validateCameraProposal(data: unknown): CameraProposal {
  if (!object(data) || data.schema !== 2 || !object(data.image))
    throw Error("Camera service returned an unsupported response.");
  const { width, height } = data.image;
  if (!whole(width) || !whole(height) || width < 1 || height < 1 || width * height > 30_000_000 ||
      (data.status !== "review" && data.status !== "partial") ||
      !Array.isArray(data.circles) || data.circles.length > 80 ||
      !Array.isArray(data.edges) || !Array.isArray(data.boardCorners) || data.boardCorners.length !== 4 ||
      !Array.isArray(data.warnings) || data.warnings.some(w => typeof w !== "string" || w.length > 250))
    throw Error("Camera service returned an invalid board.");
  for (const p of data.boardCorners) if (!Array.isArray(p) || p.length !== 2 ||
      p.some((v, axis) => typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > (axis === 0 ? width : height)))
    throw Error("Camera service returned invalid board corners.");
  const ids = new Set<string>();
  for (const raw of data.circles) {
    if (!object(raw) || typeof raw.id !== "string" || !/^c\d{1,2}$/.test(raw.id) || ids.has(raw.id) ||
        typeof raw.x !== "number" || typeof raw.y !== "number" || !Number.isFinite(raw.x) || !Number.isFinite(raw.y) ||
        raw.x < 0 || raw.y < 0 || raw.x > width || raw.y > height ||
        typeof raw.radius !== "number" || !Number.isFinite(raw.radius) || raw.radius <= 0 || raw.radius > Math.max(width, height) / 2 ||
        !validValue(raw.value) || typeof raw.detectionConfidence !== "number" || raw.detectionConfidence < 0 || raw.detectionConfidence > 1 ||
        !["read", "uncertain", "unreadable"].includes(String(raw.ocrStatus)))
      throw Error("Camera service returned an invalid circle.");
    ids.add(raw.id);
  }
  for (const edge of data.edges) if (!Array.isArray(edge) || edge.length !== 2 || !whole(edge[0]) || !whole(edge[1]) ||
      edge[0] < 0 || edge[0] >= edge[1] || edge[1] >= data.circles.length)
    throw Error("Camera service returned invalid connections.");
  if (data.status === "review") cameraToPaper(data.circles as CameraCircle[], data.boardCorners as Corner[]);
  return data as CameraProposal;
}
