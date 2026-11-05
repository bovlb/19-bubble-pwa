"""Stateless HTTP photo-to-paper-board proposal service."""

from __future__ import annotations

from collections import defaultdict, deque
from io import BytesIO
import json
import math
import os
import re
import time

import cv2
import numpy as np
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from PIL import Image, ImageOps, UnidentifiedImageError

from .geometry import Circle, connected_edges, detect_circles, detect_circles_alt, merge_candidates, proximity_edges, select_board
from .ocr import configured_client, make_contact_sheet, map_words
from .perspective import detect_board_corners, rectify, unwarp_circles


MAX_BYTES = 12 * 1024 * 1024
MAX_PIXELS = 30_000_000
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.state.ocr_client = configured_client()
_recent: dict[str, deque[float]] = defaultdict(deque)


def error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"schema": 2, "error": code, "message": message}, status_code=status)


def allowed_origin(request: Request) -> str | None:
    origin = request.headers.get("origin")
    allowed = {s.strip() for s in os.environ.get("CAMERA_ALLOWED_ORIGINS", "").split(",") if s.strip()}
    return origin if origin and origin in allowed else None


@app.middleware("http")
async def cors(request: Request, call_next):
    origin = allowed_origin(request)
    if request.method == "OPTIONS":
        response = JSONResponse({}, status_code=204 if origin else 403)
    else:
        response = await call_next(request)
    if origin:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Request-ID, X-Bubble-Geometry, X-Board-Corners"
    return response


def decode_image(raw: bytes) -> np.ndarray:
    with Image.open(BytesIO(raw)) as original:
        if original.width * original.height > MAX_PIXELS:
            raise ValueError("Image dimensions are too large")
        image = ImageOps.exif_transpose(original).convert("RGB")
        return cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)


def corrected_geometry(header: str, width: int, height: int) -> list[Circle]:
    """Validate user-corrected bubbles before spending an OCR request."""
    if len(header) > 8000:
        raise ValueError("Corrected board is too large")
    data = json.loads(header)
    if not isinstance(data, list) or len(data) != 19:
        raise ValueError("Corrected board needs 19 bubbles")
    result = []
    for item in data:
        if not isinstance(item, dict):
            raise ValueError("Invalid corrected bubble")
        x, y, radius = (item.get(k) for k in ("x", "y", "radius"))
        if (not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
                    for v in (x, y, radius)) or
                not (0 <= x <= width and 0 <= y <= height and 1 <= radius <= max(width, height) / 2)):
            raise ValueError("Invalid corrected bubble")
        result.append(Circle(float(x), float(y), float(radius), 1))
    if any(math.hypot(a.x - b.x, a.y - b.y) < 0.5 * min(a.radius, b.radius)
           for i, a in enumerate(result) for b in result[i + 1:]):
        raise ValueError("Duplicate corrected bubbles")
    if not connected_edges(19, proximity_edges(result)):
        raise ValueError("Corrected board must be connected")
    return result


def corrected_corners(header: str, width: int, height: int) -> np.ndarray:
    if len(header) > 300:
        raise ValueError("Invalid board corners")
    data = json.loads(header)
    if not isinstance(data, list) or len(data) != 4:
        raise ValueError("Invalid board corners")
    points = np.asarray(data, dtype=np.float64)
    if points.shape != (4, 2) or not np.isfinite(points).all() or np.any(points < 0) or np.any(points[:, 0] > width) or np.any(points[:, 1] > height):
        raise ValueError("Invalid board corners")
    if cv2.contourArea(points.astype(np.float32)) < width * height * 0.1:
        raise ValueError("Board corners are too close together")
    return points.astype(np.float32)


def propose_geometry(image: np.ndarray, corners: np.ndarray, found: bool) -> tuple[list[Circle], bool]:
    """Try independent views before combining noisy candidates for correction."""
    front, matrix = rectify(image, corners)
    views = [(front, matrix), (image, None)] if found else [(image, None), (front, matrix)]
    candidate_groups: list[tuple[str, list[Circle]]] = []
    complete_groups: list[list[Circle]] = []
    for view, transform in views:
        for label, detector in (
            ("classic", lambda frame: detect_circles(frame)),
            ("alt_strict", lambda frame: detect_circles_alt(frame, 0.9)),
            ("alt_relaxed", lambda frame: detect_circles_alt(frame, 0.8)),
            ("alt_rescue", lambda frame: detect_circles_alt(frame, 0.7)),
        ):
            candidates = detector(view)
            if transform is not None:
                candidates = unwarp_circles(candidates, transform)
            candidate_groups.append((label, candidates))
            selected, complete = select_board(candidates)
            if complete:
                complete_groups.append(selected)
    if complete_groups:
        # A wrong ring can still form a connected 19-node graph. Printed rings
        # on one board have nearly equal radii. Agreement across independent
        # image views and detector thresholds is stronger than either alone.
        def rank(group: list[Circle]) -> tuple[int, float]:
            consensus = sum(
                sum(any(math.hypot(c.x - other.x, c.y - other.y) <
                        0.6 * min(c.radius, other.radius) for other in proposal)
                    for c in group)
                for proposal in complete_groups if proposal is not group
            )
            variation = float(np.std([c.radius for c in group]) /
                              np.mean([c.radius for c in group]))
            return consensus, -variation
        best = max(complete_groups, key=rank)
        return best, True
    for view, transform in views:
        candidates = detect_circles(view, 0.025)
        if transform is not None:
            candidates = unwarp_circles(candidates, transform)
        candidate_groups.append(("classic_close", candidates))
        selected, complete = select_board(candidates)
        if complete:
            return selected, True
    # Mixed candidates are only suggestions for manual correction; they must
    # never be promoted automatically to a complete board.
    alt_groups = [group for label, group in candidate_groups if label.startswith("alt")]
    anchor = min((group for group in alt_groups if len(group) >= 19),
                 key=lambda group: len(group), default=None)
    if anchor is None:
        anchor = max(alt_groups, key=len, default=[])
    if not anchor:
        anchor = max((group for _, group in candidate_groups), key=len, default=[])
    other_groups = [group for _, group in candidate_groups if group is not anchor]
    return merge_candidates(anchor, *other_groups)[:25], False


@app.post("/scan")
async def scan(request: Request):
    if request.headers.get("content-type", "").split(";")[0] not in ALLOWED_TYPES:
        return error(415, "unsupported_file", "Choose a JPEG, PNG, or WebP photo.")
    declared = request.headers.get("content-length")
    if declared:
        try:
            if int(declared) > MAX_BYTES:
                return error(413, "too_large", "Photo exceeds the 12 MB limit.")
        except ValueError:
            return error(400, "bad_request", "Invalid content length.")
    request_id = request.headers.get("x-request-id", "")
    if request_id and not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", request_id):
        return error(400, "bad_request", "Invalid request ID.")
    # Best-effort local throttle. A provider/project quota must enforce the real
    # OCR spending limit, because Cloud Run instances do not share this memory.
    client = request.client.host if request.client else "unknown"
    now = time.monotonic()
    recent = _recent[client]
    while recent and recent[0] < now - 3600:
        recent.popleft()
    if len(recent) >= int(os.environ.get("CAMERA_REQUESTS_PER_HOUR", "30")):
        return error(429, "rate_limited", "Too many scans. Try again later.")
    recent.append(now)
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > MAX_BYTES:
            return error(413, "too_large", "Photo exceeds the 12 MB limit.")
    try:
        image = decode_image(bytes(raw))
    except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError):
        return error(422, "unreadable_image", "This photo could not be read. Try another image.")
    height, width = image.shape[:2]
    corner_header = request.headers.get("x-board-corners")
    try:
        corners, found = (corrected_corners(corner_header, width, height), True) if corner_header else detect_board_corners(image)
    except (ValueError, TypeError, json.JSONDecodeError):
        return error(400, "bad_corners", "Check the four board corners.")
    correction = request.headers.get("x-bubble-geometry")
    if correction:
        try:
            selected = corrected_geometry(correction, width, height)
        except (ValueError, TypeError, json.JSONDecodeError):
            return error(400, "bad_geometry", "Correct the 19 connected bubble positions before reading numbers.")
        complete = True
    else:
        selected, complete = propose_geometry(image, corners, found)
    readings = [(None, "unreadable")] * len(selected)
    warnings: list[str] = []
    if not complete:
        warnings.append("Could not verify all 19 connected bubbles. Correct the circles or retake the photo.")
    elif app.state.ocr_client is None:
        warnings.append("Handwriting OCR is unavailable. Enter the bubble values manually.")
    else:
        try:
            sheet = make_contact_sheet(image, selected)
            readings = map_words(app.state.ocr_client.read(sheet))
        except Exception:
            warnings.append("Handwriting OCR is unavailable. Enter the bubble values manually.")
    circles = []
    for i, circle in enumerate(selected):
        value, ocr_status = readings[i]
        circles.append({
            "id": f"c{i}", "x": round(circle.x, 2), "y": round(circle.y, 2),
            "radius": round(circle.radius, 2),
            "value": value, "detectionConfidence": circle.confidence,
            "ocrStatus": ocr_status,
        })
    return {
        "schema": 2,
        "status": "review" if complete else "partial",
        "image": {"width": width, "height": height},
        "boardCorners": [[round(float(x), 2), round(float(y), 2)] for x, y in corners],
        "circles": circles,
        "edges": proximity_edges(selected) if complete else [],
        "warnings": warnings,
    }


@app.get("/health")
def health():
    return {"ok": True}
