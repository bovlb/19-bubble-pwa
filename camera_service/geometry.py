"""Detect printed bubbles and fit their centers to the paper scorer's lattice."""

from __future__ import annotations

from dataclasses import dataclass
from itertools import combinations
import math

import cv2
import numpy as np


OFFSETS = {(1, 0), (-1, 0), (0, 1), (0, -1), (1, -1), (-1, 1)}


@dataclass(frozen=True)
class Circle:
    x: float
    y: float
    radius: float
    confidence: float = 0.5


@dataclass(frozen=True)
class FittedCircle:
    circle: Circle
    q: int | None
    r: int | None
    residual: float | None


def detect_circles(image: np.ndarray) -> list[Circle]:
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
    min_distance = max(14, round(s * 0.048))
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


def _fit_from_basis(circles: list[Circle], anchor: int, first: int, second: int):
    origin = np.array([circles[anchor].x, circles[anchor].y])
    basis = np.array([
        [circles[first].x - origin[0], circles[second].x - origin[0]],
        [circles[first].y - origin[1], circles[second].y - origin[1]],
    ])
    det = np.linalg.det(basis)
    step = min(np.linalg.norm(basis[:, 0]), np.linalg.norm(basis[:, 1]))
    if abs(det) < step * step * 0.6 or step < 15:
        return None
    if max(np.linalg.norm(basis[:, 0]), np.linalg.norm(basis[:, 1])) / step > 1.25:
        return None
    # Axial axes are two equal-length directions 60 degrees apart. Without
    # this condition, unrelated artwork can fit a rectangular integer grid.
    if not 0.75 <= np.linalg.norm(basis[:, 0] - basis[:, 1]) / step <= 1.3:
        return None
    coords = np.linalg.solve(basis, np.array([[c.x - origin[0], c.y - origin[1]] for c in circles]).T).T
    rounded = np.rint(coords).astype(int)
    residual = np.linalg.norm((coords - rounded) @ basis.T, axis=1) / step
    return rounded, residual


def _connected(points: list[tuple[int, int]]) -> bool:
    if not points:
        return False
    remaining = set(points)
    found = {points[0]}
    while found:
        p = found.pop()
        remaining.discard(p)
        for dq, dr in OFFSETS:
            neighbor = (p[0] + dq, p[1] + dr)
            if neighbor in remaining:
                found.add(neighbor)
    return not remaining


def _fit_contact_graph(circles: list[Circle]) -> list[FittedCircle] | None:
    """Embed nearly touching rings using their six approximate directions.

    Official layouts bend the printed rows, so a single affine transform is
    often too rigid. Contact edges provide local constraints while the axial
    result still goes through the paper scorer's exact neighbor rule.
    """
    if len(circles) != 19:
        return None
    contacts = []
    for a, first in enumerate(circles):
        for b in range(a + 1, len(circles)):
            second = circles[b]
            vector = np.array([second.x - first.x, second.y - first.y])
            ratio = np.linalg.norm(vector) / (first.radius + second.radius)
            if 0.7 < ratio < 1.25 and 0.75 < first.radius / second.radius < 1.33:
                contacts.append((a, b, vector))
    if not 19 <= len(contacts) <= 40:
        return None
    directions = np.array([(1, 0), (0, 1), (-1, 1), (-1, 0), (0, -1), (1, -1)])
    best: tuple[float, np.ndarray] | None = None
    for angle in range(60):
        radians = np.deg2rad(angle + np.arange(6) * 60)
        unit = np.stack((np.cos(radians), np.sin(radians)), axis=1)
        system = np.zeros((len(contacts) + 1, 19))
        targets = np.zeros((len(contacts) + 1, 2))
        system[-1, 0] = 1
        for row, (a, b, vector) in enumerate(contacts):
            system[row, a], system[row, b] = -1, 1
            targets[row] = directions[int(np.argmax(unit @ vector))]
        positions = np.rint(np.linalg.lstsq(system, targets, rcond=None)[0]).astype(int)
        points = [tuple(position) for position in positions]
        if not connected(points):
            continue
        predicted = set(edges_for(points))
        observed = {(a, b) for a, b, _ in contacts}
        if len(observed - predicted) > 1 or len(predicted - observed) > 3:
            continue
        error = float(np.sum((system @ positions - targets) ** 2))
        if best is None or error < best[0]:
            best = (error, positions)
    if best is None:
        return None
    return [FittedCircle(circle, int(q), int(r), 0.0)
            for circle, (q, r) in zip(circles, best[1])]


def fit_lattice(circles: list[Circle]) -> list[FittedCircle]:
    """Fit a six-neighbor lattice to circle centers, preserving unmatched candidates.

    The search uses pairs of nearby center vectors as candidate lattice axes.
    Its output is a proposal, not an asserted board: the client must review it.
    """
    if not circles:
        return []
    complete = _fit_contact_graph(circles[:19])
    if complete is not None:
        return complete
    # Preserve a manageable set of high-support candidates for manual repair.
    # Unselected candidates are not invented or sent for paid OCR.
    circles = circles[:25]
    median_radius = float(np.median([c.radius for c in circles]))
    best: tuple[float, np.ndarray, np.ndarray] | None = None
    centers = np.array([[c.x, c.y] for c in circles])
    # Lattice neighbor spacing is close to two bubble radii in these boards.
    for anchor, center in enumerate(centers):
        distances = np.linalg.norm(centers - center, axis=1)
        neighbors = [i for i in np.argsort(distances)[1:10]
                     if 1.35 * median_radius <= distances[i] <= 3.0 * median_radius]
        for first, second in combinations(neighbors, 2):
            for a, b in ((first, second), (second, first)):
                fitted = _fit_from_basis(circles, anchor, a, b)
                if fitted is None:
                    continue
                rounded, residual = fitted
                by_position: dict[tuple[int, int], int] = {}
                for i in np.argsort(residual):
                    p = (int(rounded[i, 0]), int(rounded[i, 1]))
                    if residual[i] <= 0.28 and p not in by_position:
                        by_position[p] = int(i)
                selected = list(by_position.values())
                if len(selected) < 4:
                    continue
                # Favor many centers, low residual, and one connected component.
                points = list(by_position)
                connected_bonus = 3 if len(points) == 19 and _connected(points) else 0
                score = len(selected) + connected_bonus - sum(float(residual[i]) for i in selected) * 0.3
                if best is None or score > best[0]:
                    best = (score, rounded, residual)
    if best is None:
        return [FittedCircle(c, None, None, None) for c in circles]
    _, coords, residual = best
    used: set[tuple[int, int]] = set()
    result: list[FittedCircle] = []
    for i in sorted(range(len(circles)), key=lambda i: float(residual[i])):
        p = (int(coords[i, 0]), int(coords[i, 1]))
        if residual[i] <= 0.28 and p not in used:
            used.add(p)
            result.append(FittedCircle(circles[i], p[0], p[1], float(residual[i])))
        else:
            result.append(FittedCircle(circles[i], None, None, None))
    return result


def edges_for(points: list[tuple[int, int]]) -> list[tuple[int, int]]:
    return [(a, b) for a in range(len(points)) for b in range(a + 1, len(points))
            if (points[b][0] - points[a][0], points[b][1] - points[a][1]) in OFFSETS]


def connected(points: list[tuple[int, int]]) -> bool:
    return len(set(points)) == len(points) and _connected(points)
