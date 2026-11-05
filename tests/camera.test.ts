import { describe, expect, it } from "vitest";
import {
  cameraEdges,
  cameraToPaper,
  validateCameraProposal,
  type CameraCircle,
} from "../src/camera";
import { decodePaperGraph, type Point } from "../src/paper";

const points: Point[] = Array.from({ length: 19 }, (_, i) => [
  (i % 7) - Math.floor(Math.floor(i / 7) / 2),
  Math.floor(i / 7),
]);
const circles: CameraCircle[] = points.map(([q, r], i) => ({
  id: `c${i}`,
  x: 40 + 56 * (q + r / 2),
  y: 40 + 49 * r,
  radius: 22,
  value: i === 0 ? 0 : i === 1 ? null : i,
  detectionConfidence: 0.9,
  ocrStatus: i === 1 ? "unreadable" : "read",
}));

describe("camera proposal", () => {
  it("keeps explicit proximity edges and preserves zero and blank", () => {
    const reversed = [...circles].reverse();
    const imported = cameraToPaper(reversed);
    expect(imported.token.startsWith("2.")).toBe(true);
    expect(imported.values[0]).toBe(18);
    expect(imported.values[17]).toBe(null);
    expect(imported.values[18]).toBe(0);
    expect(decodePaperGraph(imported.token)).toEqual(imported.graph);
  });
  it("validates the reviewable proposal and rejects duplicate positions", () => {
    const proposal = {
      schema: 2,
      status: "review",
      image: { width: 1000, height: 1000 },
      boardCorners: [[0, 0], [999, 0], [999, 999], [0, 999]],
      circles,
      edges: cameraEdges(circles),
      warnings: [],
    };
    expect(validateCameraProposal(proposal).circles).toHaveLength(19);
    expect(() =>
      validateCameraProposal({
        ...proposal,
        circles: circles.map((c, i) =>
          i === 18 ? { ...c, x: circles[0].x, y: circles[0].y } : c,
        ),
      }),
    ).toThrow();
  });
  it("keeps partial detections reviewable without accepting them as a paper board", () => {
    const partial = validateCameraProposal({
      schema: 2,
      status: "partial",
      image: { width: 1000, height: 1000 },
      boardCorners: [[0, 0], [999, 0], [999, 999], [0, 999]],
      circles: circles.slice(0, 18),
      edges: [],
      warnings: ["Retake or correct"],
    });
    expect(partial.status).toBe("partial");
    expect(() => cameraToPaper(partial.circles)).toThrow();
  });
});
