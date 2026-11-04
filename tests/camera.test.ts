import { describe, expect, it } from "vitest";
import {
  cameraEdges,
  cameraToPaper,
  validateCameraProposal,
  type CameraCircle,
} from "../src/camera";
import { encodeShape, paperGraph, type Point } from "../src/paper";

const points: Point[] = Array.from({ length: 19 }, (_, i) => [
  (i % 7) - Math.floor(Math.floor(i / 7) / 2),
  Math.floor(i / 7),
]);
const circles: CameraCircle[] = points.map(([q, r], i) => ({
  id: `c${i}`,
  x: 40 + 56 * (q + r / 2),
  y: 40 + 49 * r,
  radius: 22,
  q,
  r,
  value: i === 0 ? 0 : i === 1 ? null : i,
  detectionConfidence: 0.9,
  ocrStatus: i === 1 ? "unreadable" : "read",
}));

describe("camera proposal", () => {
  it("maps values to normalized paper positions without changing zero or blank", () => {
    const reversed = [...circles].reverse();
    const imported = cameraToPaper(reversed);
    expect(imported.token).toBe(encodeShape(points));
    expect(imported.values[0]).toBe(0);
    expect(imported.values[1]).toBe(null);
    expect(imported.values[18]).toBe(18);
    expect(paperGraph(imported.points).edges).toEqual(paperGraph(points).edges);
  });
  it("rejects invented edges and duplicate lattice positions", () => {
    const proposal = {
      schema: 1,
      status: "review",
      image: { width: 1000, height: 1000 },
      circles,
      edges: cameraEdges(circles),
      warnings: [],
    };
    expect(validateCameraProposal(proposal).circles).toHaveLength(19);
    expect(() =>
      validateCameraProposal({ ...proposal, edges: [[0, 18]] }),
    ).toThrow();
    expect(() =>
      validateCameraProposal({
        ...proposal,
        circles: circles.map((c, i) =>
          i === 18 ? { ...c, q: circles[0].q, r: circles[0].r } : c,
        ),
      }),
    ).toThrow();
  });
  it("keeps partial detections reviewable without accepting them as a paper board", () => {
    const partial = validateCameraProposal({
      schema: 1,
      status: "partial",
      image: { width: 1000, height: 1000 },
      circles: circles.slice(0, 18),
      edges: [],
      warnings: ["Retake or correct"],
    });
    expect(partial.status).toBe("partial");
    expect(() => cameraToPaper(partial.circles)).toThrow();
  });
});
