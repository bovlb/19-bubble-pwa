import json

import cv2
import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from camera_service.app import app
from camera_service.geometry import Circle, connected, detect_circles, edges_for, fit_lattice
from camera_service.ocr import GUTTER, TILE, make_contact_sheet, map_words


POINTS = [(col - row // 2, row) for row, count in enumerate((7, 7, 5)) for col in range(count)]


def board_image() -> np.ndarray:
    image = np.full((430, 680, 3), 240, dtype=np.uint8)
    for q, r in POINTS:
        x, y = round(80 + 76 * (q + r / 2)), round(90 + 66 * r)
        cv2.circle(image, (x, y), 32, (25, 25, 25), 2, cv2.LINE_AA)
    # A printed score grid is not a set of bubbles.
    for x in range(10, 180, 20):
        cv2.line(image, (x, 350), (x, 420), (50, 50, 50), 1)
    return image


def jpeg(image: np.ndarray) -> bytes:
    return cv2.imencode(".jpg", image)[1].tobytes()


def test_detects_clean_board_and_fits_connected_lattice():
    circles = detect_circles(board_image())
    assert len(circles) >= 19
    fitted = fit_lattice(circles)
    placed = [(f.q, f.r) for f in fitted if f.q is not None]
    assert len(placed) >= 19
    assert connected(placed[:19]) or len(placed) > 19


def test_contact_sheet_has_nineteen_spaced_tiles_and_maps_box():
    circles = [Circle(80 + i % 5 * 76, 80 + i // 5 * 76, 30) for i in range(19)]
    sheet = make_contact_sheet(board_image(), circles)
    assert sheet.shape[:2] == (4 * TILE + 5 * GUTTER, 5 * TILE + 6 * GUTTER)
    words = [{"text": "0", "vertices": [
        {"x": GUTTER + 30, "y": GUTTER + 30},
        {"x": GUTTER + 55, "y": GUTTER + 30},
        {"x": GUTTER + 55, "y": GUTTER + 70},
        {"x": GUTTER + 30, "y": GUTTER + 70},
    ], "confidence": 0.95}]
    mapped = map_words(words)
    assert mapped[0] == (0, "read")
    assert mapped[1] == (None, "unreadable")
    assert mapped[18] == (None, "unreadable")


def test_ocr_rejects_conflicts_invalid_values_and_cross_tile_boxes():
    def box(text, x, y, width=20):
        return {"text": text, "vertices": [
            {"x": x, "y": y}, {"x": x + width, "y": y},
            {"x": x + width, "y": y + 20}, {"x": x, "y": y + 20},
        ]}
    words = [
        box("12", 30, 30), box("3", 60, 30),
        box("31", 250, 30), box("abc", 470, 30),
        box("7", GUTTER + TILE - 10, 40, 40),
    ]
    result = map_words(words)
    assert result[0] == (None, "uncertain")
    assert result[1] == (None, "uncertain")
    assert result[2] == (None, "uncertain")


def test_ocr_keeps_zero_and_two_digit_values_distinct_from_blank():
    words = []
    for index, label in enumerate(("0", "1", "10", "30")):
        left = GUTTER + index * (TILE + GUTTER) + 30
        words.append({"text": label, "vertices": [
            {"x": left, "y": 40}, {"x": left + 30, "y": 40},
            {"x": left + 30, "y": 70}, {"x": left, "y": 70},
        ], "confidence": 0.98})
    readings = map_words(words)
    assert [reading[0] for reading in readings[:5]] == [0, 1, 10, 30, None]
    assert readings[4][1] == "unreadable"


def test_endpoint_returns_reviewable_geometry_without_paid_ocr():
    original = app.state.ocr_client
    app.state.ocr_client = None
    try:
        response = TestClient(app).post(
            "/scan", content=jpeg(board_image()),
            headers={"Content-Type": "image/jpeg", "X-Request-ID": "test-board"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["schema"] == 1
        assert data["image"] == {"width": 680, "height": 430}
        assert len(data["circles"]) >= 19
        assert all(c["value"] is None for c in data["circles"])
    finally:
        app.state.ocr_client = original


def test_endpoint_rejects_bad_input():
    client = TestClient(app)
    assert client.post("/scan", content=b"hello", headers={"Content-Type": "text/plain"}).status_code == 415
    assert client.post("/scan", content=b"hello", headers={"Content-Type": "image/png"}).status_code == 422
    assert client.post("/scan", content=b"x" * (12 * 1024 * 1024 + 1), headers={"Content-Type": "image/png"}).status_code == 413


def test_corrected_geometry_uses_one_contact_sheet_ocr_call():
    class FakeOCR:
        calls = 0

        def read(self, image):
            self.calls += 1
            assert image.shape[:2] == (4 * TILE + 5 * GUTTER, 5 * TILE + 6 * GUTTER)
            return [{"text": "12", "vertices": [
                {"x": 40, "y": 40}, {"x": 65, "y": 40},
                {"x": 65, "y": 70}, {"x": 40, "y": 70},
            ], "confidence": 0.99}]

    geometry = [{"x": 80 + 76 * (q + r / 2), "y": 90 + 66 * r,
                 "radius": 32, "q": q, "r": r} for q, r in POINTS]
    original = app.state.ocr_client
    fake = FakeOCR()
    app.state.ocr_client = fake
    try:
        response = TestClient(app).post("/scan", content=jpeg(board_image()), headers={
            "Content-Type": "image/jpeg", "X-Bubble-Geometry": json.dumps(geometry),
        })
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "review"
        assert len(data["circles"]) == 19
        assert data["circles"][0]["value"] == 12
        assert fake.calls == 1
        geometry[0]["q"] = geometry[1]["q"]
        geometry[0]["r"] = geometry[1]["r"]
        invalid = TestClient(app).post("/scan", content=jpeg(board_image()), headers={
            "Content-Type": "image/jpeg", "X-Bubble-Geometry": json.dumps(geometry),
        })
        assert invalid.status_code == 400
        assert fake.calls == 1
    finally:
        app.state.ocr_client = original
