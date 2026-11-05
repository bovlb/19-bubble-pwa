"""Local-only review UI for creating private, human-checked photo labels.

Run: .venv/bin/python -m camera_service.tools.golden_labeler --images PATH [--images PATH]
The server never writes photos or labels and never calls paid OCR.
"""

from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient

from camera_service.app import app


def image_registry(directories: list[Path]) -> dict[str, Path]:
    images = {}
    for directory in directories:
        if not directory.is_dir():
            raise ValueError(f"Image directory not found: {directory}")
        for path in sorted(directory.iterdir()):
            if path.suffix.lower() not in {".jpeg", ".jpg", ".png", ".webp"}:
                continue
            key = f"{directory.name}/{path.name}"
            if key in images:
                raise ValueError(f"Duplicate image name: {key}")
            images[key] = path
    if not images:
        raise ValueError("No JPEG, PNG, or WebP images found")
    return images


def serve(images: dict[str, Path], port: int) -> None:
    # This labeler is for geometry truth. Keep paid OCR off even when the
    # developer's normal service environment has a provider configured.
    app.state.ocr_client = None
    os.environ["CAMERA_REQUESTS_PER_HOUR"] = "10000"
    client = TestClient(app)
    html = Path(__file__).with_name("golden_labeler.html").read_bytes()

    class Handler(BaseHTTPRequestHandler):
        def send(self, code: int, kind: str, data: bytes) -> None:
            self.send_response(code)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None:
            url = urlparse(self.path)
            if url.path == "/":
                return self.send(200, "text/html; charset=utf-8", html)
            if url.path == "/api/images":
                data = json.dumps(list(images)).encode()
                return self.send(200, "application/json", data)
            if url.path not in {"/api/image", "/api/proposal"}:
                return self.send(404, "text/plain", b"Not found")
            key = parse_qs(url.query).get("key", [""])[0]
            path = images.get(key)
            if path is None:
                return self.send(404, "text/plain", b"Unknown image")
            raw = path.read_bytes()
            content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            if url.path == "/api/image":
                return self.send(200, content_type, raw)
            response = client.post("/scan", content=raw, headers={"Content-Type": content_type})
            return self.send(response.status_code, "application/json", response.content)

        def log_message(self, format: str, *args) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Golden labeler: http://127.0.0.1:{server.server_port}", flush=True)
    print(f"Loaded {len(images)} local images. Press Ctrl-C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--images", action="append", type=Path, required=True,
                        help="Directory containing local board photos; repeatable")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("Port must be between 1024 and 65535")
    serve(image_registry(args.images), args.port)


if __name__ == "__main__":
    main()
