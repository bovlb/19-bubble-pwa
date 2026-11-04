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

from .geometry import Circle, FittedCircle, connected, detect_circles, edges_for, fit_lattice
from .ocr import configured_client, make_contact_sheet, map_words


MAX_BYTES = 12 * 1024 * 1024
MAX_PIXELS = 30_000_000
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.state.ocr_client = configured_client()
_recent: dict[str, deque[float]] = defaultdict(deque)


def error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"schema": 1, "error": code, "message": message}, status_code=status)


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
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Request-ID, X-Bubble-Geometry"
    return response


def decode_image(raw: bytes) -> np.ndarray:
    with Image.open(BytesIO(raw)) as original:
        if original.width * original.height > MAX_PIXELS:
            raise ValueError("Image dimensions are too large")
        image = ImageOps.exif_transpose(original).convert("RGB")
        return cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)


def corrected_geometry(header: str, width: int, height: int) -> list[FittedCircle]:
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
        x, y, radius, q, r = (item.get(k) for k in ("x", "y", "radius", "q", "r"))
        if (not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
                    for v in (x, y, radius)) or
                not all(isinstance(v, int) and not isinstance(v, bool) and abs(v) <= 36
                        for v in (q, r)) or
                not (0 <= x <= width and 0 <= y <= height and 1 <= radius <= max(width, height) / 2)):
            raise ValueError("Invalid corrected bubble")
        result.append(FittedCircle(Circle(float(x), float(y), float(radius), 1), q, r, 0))
    if not connected([(f.q, f.r) for f in result]):
        raise ValueError("Corrected board must be connected")
    return result


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
    correction = request.headers.get("x-bubble-geometry")
    if correction:
        try:
            selected = corrected_geometry(correction, width, height)
        except (ValueError, TypeError, json.JSONDecodeError):
            return error(400, "bad_geometry", "Correct the 19 bubble positions before reading numbers.")
        complete = True
    else:
        candidates = detect_circles(image)
        fitted = fit_lattice(candidates)
        assigned = [f for f in fitted if f.q is not None and f.r is not None]
        assigned.sort(key=lambda f: (f.r, f.q))
        complete = len(assigned) == 19 and connected([(f.q, f.r) for f in assigned])
        # Keep candidates for manual repair. Do not send a guessed subset to OCR.
        selected = assigned if complete else fitted
    readings = [(None, "unreadable")] * len(selected)
    warnings: list[str] = []
    if not complete:
        warnings.append("Could not verify all 19 connected bubbles. Correct the circles and positions, or retake the photo.")
    elif app.state.ocr_client is None:
        warnings.append("Handwriting OCR is unavailable. Enter the bubble values manually.")
    else:
        try:
            sheet = make_contact_sheet(image, [f.circle for f in selected])
            readings = map_words(app.state.ocr_client.read(sheet))
        except Exception:
            warnings.append("Handwriting OCR is unavailable. Enter the bubble values manually.")
    circles = []
    for i, f in enumerate(selected):
        value, ocr_status = readings[i]
        circles.append({
            "id": f"c{i}", "x": round(f.circle.x, 2), "y": round(f.circle.y, 2),
            "radius": round(f.circle.radius, 2), "q": f.q, "r": f.r,
            "value": value, "detectionConfidence": f.circle.confidence,
            "ocrStatus": ocr_status,
        })
    points = [(f.q, f.r) for f in selected] if complete else []
    return {
        "schema": 1,
        "status": "review" if complete else "partial",
        "image": {"width": width, "height": height},
        "circles": circles,
        "edges": edges_for(points),
        "warnings": warnings,
    }


@app.get("/health")
def health():
    return {"ok": True}
