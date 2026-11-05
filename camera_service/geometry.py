"""Detect printed bubbles and infer neighbors from nearly touching rings."""

from __future__ import annotations

from dataclasses import dataclass
import math

import cv2
import numpy as np


@dataclass(frozen=True)
class Circle:
    x: float
    y: float
    radius: float
    confidence: float = 0.5


def merge_candidates(*groups: list[Circle]) -> list[Circle]:
    """Combine image-space detections, preferring earlier groups at overlaps."""
    merged: list[Circle] = []
    for group in groups:
        for circle in group:
            if any(math.hypot(circle.x - other.x, circle.y - other.y) <
                   0.65 * min(circle.radius, other.radius) for other in merged):
                continue
            merged.append(circle)
    return merged


def detect_circles_alt(image: np.ndarray, threshold: float = 0.9) -> list[Circle]:
    """Use OpenCV's arc-based Hough detector as an independent ring proposal."""
    height, width = image.shape[:2]
    short = min(height, width)
    scale = min(1.0, 1200 / short)
    small = cv2.resize(image, None, fx=scale, fy=scale) if scale < 1 else image
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    gray = cv2.GaussianBlur(gray, (5, 5), 1.2)
    s = min(gray.shape)
    found = cv2.HoughCircles(
        gray, cv2.HOUGH_GRADIENT_ALT, dp=1.2,
        minDist=max(10, round(s * 0.025)), param1=220, param2=threshold,
        minRadius=max(7, round(s * 0.02)), maxRadius=round(s * 0.11),
    )
    if found is None:
        return []
    return [Circle(float(x / scale), float(y / scale), float(r / scale), threshold)
            for x, y, r in found[0]]


def detect_circles(image: np.ndarray, min_distance_factor: float = 0.048) -> list[Circle]:
    """Return plausible ring candidates; do not manufacture a 19th bubble."""
    height, width = image.shape[:2]
    short = min(height, width)
    scale = min(1.0, 1200 / short)
    small = cv2.resize(image, None, fx=scale, fy=scale) if scale < 1 else image
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    gray = cv2.GaussianBlur(gray, (5, 5), 1.2)
    gradient_x = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gradient_y = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    s = min(gray.shape)
    min_radius = max(9, round(s * 0.024))
    max_radius = max(min_radius + 2, round(s * 0.095))
    # A close second pass can recover a real bubble suppressed by a nearby
    # false Hough peak. The caller retains the more conservative first pass.
    min_distance = max(10, round(s * min_distance_factor))
    raw: list[Circle] = []
    for threshold in (30, 23, 18):
        found = cv2.HoughCircles(
            gray,
            cv2.HOUGH_GRADIENT,
            dp=1.2,
            minDist=min_distance,
            param1=110,
            param2=threshold,
            minRadius=min_radius,
            maxRadius=max_radius,
        )
        if found is not None:
            raw.extend(Circle(float(x), float(y), float(r)) for x, y, r in found[0])
    # A true bubble has a radial edge around most of its circumference. Artwork
    # and rectangular score cells can trigger Hough, but rarely have this support.
    angles = np.linspace(0, 2 * np.pi, 96, endpoint=False)
    cos, sin = np.cos(angles), np.sin(angles)
    scored: list[Circle] = []
    for circle in raw:
        samples = []
        for radius in (circle.radius - 2, circle.radius, circle.radius + 2):
            xs = np.clip(np.rint(circle.x + radius * cos).astype(int), 0, gray.shape[1] - 1)
            ys = np.clip(np.rint(circle.y + radius * sin).astype(int), 0, gray.shape[0] - 1)
            radial = np.abs(gradient_x[ys, xs] * cos + gradient_y[ys, xs] * sin)
            tangent = np.abs(-gradient_x[ys, xs] * sin + gradient_y[ys, xs] * cos)
            samples.append((radial > 35) & (radial > tangent * 1.2))
        support = float(np.mean(np.any(samples, axis=0)))
        if support >= 0.4:
            scored.append(Circle(circle.x / scale, circle.y / scale,
                                 circle.radius / scale, support))
    # Hough can find both strokes of a double ring. Keep one detection per center.
    merged: list[Circle] = []
    for circle in sorted(scored, key=lambda c: -c.confidence):
        if any(math.hypot(circle.x - c.x, circle.y - c.y) <
               0.7 * min(circle.radius, c.radius) for c in merged):
            continue
        merged.append(circle)
    return merged[:60]


def proximity_edges(circles: list[Circle]) -> list[tuple[int, int]]:
    """A printed adjacency has a center distance near the sum of ring radii."""
    return [(a, b) for a, first in enumerate(circles)
            for b in range(a + 1, len(circles))
            if 0.72 <= math.hypot(first.x - circles[b].x, first.y - circles[b].y)
            / (first.radius + circles[b].radius) <= 1.2]


def connected_edges(count: int, edges: list[tuple[int, int]]) -> bool:
    if count != 19:
        return False
    seen = {0}
    for _ in range(count):
        for a, b in edges:
            if a in seen: seen.add(b)
            if b in seen: seen.add(a)
    return len(seen) == count


def select_board(candidates: list[Circle]) -> tuple[list[Circle], bool]:
    """Choose a strong 19-ring component, keeping candidates if uncertain."""
    if len(candidates) < 19:
        return candidates[:25], False
    # Hough confidence is useful, but proximity is the stronger board clue.
    selected = candidates[:19]
    if plausible_board(selected):
        return selected, True
    # Greedily grow the largest locally touching component from each seed.
    best: list[int] = []
    limit = min(len(candidates), 45)
    neighbors = proximity_edges(candidates[:limit])
    for seed in range(limit):
        group = [seed]
        while len(group) < 19:
            options = {b if a in group else a for a, b in neighbors
                       if (a in group) != (b in group)}
            if not options:
                break
            chosen = max(options, key=lambda i: (
                sum(a in group or b in group for a, b in neighbors if i in (a, b)),
                candidates[i].confidence))
            group.append(chosen)
        if len(group) > len(best):
            best = group
        if len(group) == 19:
            rings = [candidates[i] for i in sorted(group)]
            if plausible_board(rings):
                return rings, True
    return candidates[:25], False


def plausible_board(circles: list[Circle]) -> bool:
    if len(circles) != 19:
        return False
    radii = np.asarray([c.radius for c in circles])
    if float(radii.std() / radii.mean()) > 0.12:
        return False
    distances = [math.hypot(a.x - b.x, a.y - b.y) / (a.radius + b.radius)
                 for i, a in enumerate(circles) for b in circles[i + 1:]]
    if min(distances) < 0.78:
        return False
    edges = proximity_edges(circles)
    if not connected_edges(19, edges) or not 18 <= len(edges) <= 38:
        return False
    return max(sum(i in edge for edge in edges) for i in range(19)) <= 6
