"""Find the paper card and map it into a front-facing image."""

from __future__ import annotations

import cv2
import numpy as np


def order_corners(points: np.ndarray) -> np.ndarray:
    p = np.asarray(points, dtype=np.float32).reshape(4, 2)
    center = p.mean(axis=0)
    p = p[np.argsort(np.arctan2(p[:, 1] - center[1], p[:, 0] - center[0]))]
    return np.roll(p, -int(np.argmin(p.sum(axis=1))), axis=0)


def detect_board_corners(image: np.ndarray) -> tuple[np.ndarray, bool]:
    height, width = image.shape[:2]
    full = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], np.float32)
    scale = min(1.0, 1100 / max(height, width))
    small = cv2.resize(image, None, fx=scale, fy=scale) if scale < 1 else image
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, 45, 130)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    minimum = small.shape[0] * small.shape[1] * 0.3
    choices = []
    for contour in contours:
        perimeter = cv2.arcLength(contour, True)
        polygon = cv2.approxPolyDP(contour, 0.025 * perimeter, True)
        if len(polygon) != 4 or not cv2.isContourConvex(polygon):
            continue
        area = cv2.contourArea(polygon)
        if area >= minimum:
            points = polygon[:, 0, :] / scale
            # A contour that follows multiple frame edges is usually the crop
            # boundary, not four visible paper corners.
            on_frame = ((points[:, 0] <= 2) | (points[:, 0] >= width - 3) |
                        (points[:, 1] <= 2) | (points[:, 1] >= height - 3))
            if np.count_nonzero(on_frame) >= 2:
                continue
            choices.append((area, order_corners(points)))
    if not choices:
        return full, False
    return max(choices, key=lambda item: item[0])[1], True


def rectify(image: np.ndarray, corners: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    p = order_corners(corners)
    top = np.linalg.norm(p[1] - p[0]); bottom = np.linalg.norm(p[2] - p[3])
    left = np.linalg.norm(p[3] - p[0]); right = np.linalg.norm(p[2] - p[1])
    width = int(np.clip(max(top, bottom), 250, 1400))
    height = int(np.clip(max(left, right), 250, 1400))
    destination = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], np.float32)
    matrix = cv2.getPerspectiveTransform(p, destination)
    return cv2.warpPerspective(image, matrix, (width, height)), matrix


def unwarp_circles(circles, matrix: np.ndarray):
    from .geometry import Circle
    inverse = np.linalg.inv(matrix)
    result = []
    for c in circles:
        samples = np.array([[[c.x, c.y], [c.x + c.radius, c.y], [c.x, c.y + c.radius]]], np.float32)
        center, x_edge, y_edge = cv2.perspectiveTransform(samples, inverse)[0]
        radius = (np.linalg.norm(x_edge - center) + np.linalg.norm(y_edge - center)) / 2
        result.append(Circle(float(center[0]), float(center[1]), float(radius), c.confidence))
    return result
