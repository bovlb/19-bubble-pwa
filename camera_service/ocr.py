"""One-image contact-sheet OCR for the nineteen selected bubbles."""

from __future__ import annotations

import os
import re
from typing import Protocol

import cv2
import numpy as np

from .geometry import Circle


TILE = 192
GUTTER = 24
COLUMNS = 5
ROWS = 4


class OCRClient(Protocol):
    def read(self, image: np.ndarray) -> list[dict]: ...


class CloudVisionOCR:
    """Use the Cloud Run service identity; never send credentials to the browser."""

    def read(self, image: np.ndarray) -> list[dict]:
        import google.auth
        from google.auth.transport.requests import AuthorizedSession

        credentials, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        session = AuthorizedSession(credentials)
        encoded = cv2.imencode(".png", image)[1].tobytes()
        import base64

        response = session.post(
            "https://vision.googleapis.com/v1/images:annotate",
            json={"requests": [{
                "image": {"content": base64.b64encode(encoded).decode("ascii")},
                "features": [{"type": "DOCUMENT_TEXT_DETECTION"}],
            }]},
            timeout=25,
        )
        response.raise_for_status()
        result = response.json()["responses"][0]
        if "error" in result:
            raise RuntimeError("Handwriting recognition is unavailable")
        words = []
        for page in result.get("fullTextAnnotation", {}).get("pages", []):
            for block in page.get("blocks", []):
                for paragraph in block.get("paragraphs", []):
                    for word in paragraph.get("words", []):
                        words.append({
                            "text": "".join(s.get("text", "") for s in word.get("symbols", [])),
                            "vertices": word.get("boundingBox", {}).get("vertices", []),
                            "confidence": word.get("confidence"),
                        })
        return words


def make_contact_sheet(image: np.ndarray, circles: list[Circle]) -> np.ndarray:
    if len(circles) != 19:
        raise ValueError("Contact sheet requires exactly 19 bubbles")
    sheet = np.full((ROWS * TILE + (ROWS + 1) * GUTTER,
                     COLUMNS * TILE + (COLUMNS + 1) * GUTTER, 3), 255, np.uint8)
    height, width = image.shape[:2]
    for index, circle in enumerate(circles):
        radius = circle.radius * 0.78
        x0 = max(0, int(circle.x - radius))
        y0 = max(0, int(circle.y - radius))
        x1 = min(width, int(circle.x + radius))
        y1 = min(height, int(circle.y + radius))
        if x1 <= x0 or y1 <= y0:
            continue
        crop = image[y0:y1, x0:x1]
        size = TILE - 32
        factor = min(size / crop.shape[1], size / crop.shape[0])
        resized = cv2.resize(crop, None, fx=factor, fy=factor,
                             interpolation=cv2.INTER_CUBIC if factor > 1 else cv2.INTER_AREA)
        col, row = index % COLUMNS, index // COLUMNS
        left = GUTTER + col * (TILE + GUTTER) + (TILE - resized.shape[1]) // 2
        top = GUTTER + row * (TILE + GUTTER) + (TILE - resized.shape[0]) // 2
        sheet[top:top + resized.shape[0], left:left + resized.shape[1]] = resized
    return sheet


def map_words(words: list[dict]) -> list[tuple[int | None, str]]:
    """Map OCR boxes to cells, refusing conflicting or out-of-range readings."""
    assigned: list[list[tuple[str, float | None]]] = [[] for _ in range(19)]
    for word in words:
        vertices = word.get("vertices") or []
        if not vertices:
            continue
        xs = [v.get("x", 0) for v in vertices]
        ys = [v.get("y", 0) for v in vertices]
        x, y = sum(xs) / len(xs), sum(ys) / len(ys)
        col = int((x - GUTTER) // (TILE + GUTTER))
        row = int((y - GUTTER) // (TILE + GUTTER))
        if not (0 <= col < COLUMNS and 0 <= row < ROWS):
            continue
        index = row * COLUMNS + col
        if index >= 19:
            continue
        left = GUTTER + col * (TILE + GUTTER)
        top = GUTTER + row * (TILE + GUTTER)
        # Boxes in gutters or spanning tiles must not be assigned by center alone.
        if min(xs) < left or max(xs) > left + TILE or min(ys) < top or max(ys) > top + TILE:
            continue
        assigned[index].append((str(word.get("text", "")), word.get("confidence")))
    result = []
    for found in assigned:
        if len(found) != 1:
            result.append((None, "unreadable" if not found else "uncertain"))
            continue
        text, confidence = found[0]
        if not re.fullmatch(r"\d{1,2}", text):
            result.append((None, "uncertain"))
            continue
        value = int(text)
        if value > 30:
            result.append((None, "uncertain"))
        else:
            result.append((value, "read" if confidence is None or confidence >= 0.75 else "uncertain"))
    return result


def configured_client() -> OCRClient | None:
    if os.environ.get("CAMERA_OCR_PROVIDER") == "google-vision":
        return CloudVisionOCR()
    return None
