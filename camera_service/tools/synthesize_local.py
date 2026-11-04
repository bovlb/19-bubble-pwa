"""Create local, deterministic filled-board fixtures from an annotated blank.

Usage: python -m camera_service.tools.synthesize_local blank.webp centers.json outdir
The 19-entry JSON must contain x, y, radius, q, r. Outputs contain official
artwork, so keep the output directory local and do not commit its contents.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import random

import cv2
import numpy as np

from camera_service.geometry import connected, edges_for


def generate(source: Path, annotation: Path, destination: Path, seed: int) -> None:
    board = cv2.imread(str(source))
    if board is None:
        raise ValueError("Cannot read blank board")
    circles = json.loads(annotation.read_text())
    if (not isinstance(circles, list) or len(circles) != 19 or
            not connected([(c["q"], c["r"]) for c in circles])):
        raise ValueError("Annotation must contain 19 connected circles")
    randomizer = random.Random(seed)
    values = [randomizer.randint(0, 30) for _ in circles]
    values[0], values[1], values[2] = 0, 10, 30
    destination.mkdir(parents=True, exist_ok=True)
    truth = {"source": source.name, "seed": seed, "circles": [
        {**circle, "value": value} for circle, value in zip(circles, values)
    ], "edges": edges_for([(c["q"], c["r"]) for c in circles])}
    (destination / "truth.json").write_text(json.dumps(truth, indent=2) + "\n")
    filled = board.copy()
    for circle, value in zip(circles, values):
        label = str(value)
        radius = circle["radius"]
        scale = radius / (40 if len(label) == 1 else 51)
        thickness = max(1, round(radius / 16))
        width, height = cv2.getTextSize(label, cv2.FONT_HERSHEY_SCRIPT_SIMPLEX,
                                         scale, thickness)[0]
        x = round(circle["x"] - width / 2 + randomizer.uniform(-0.1, 0.1) * radius)
        y = round(circle["y"] + height / 2 + randomizer.uniform(-0.1, 0.1) * radius)
        cv2.putText(filled, label, (x, y), cv2.FONT_HERSHEY_SCRIPT_SIMPLEX,
                    scale, (28, 27, 32), thickness, cv2.LINE_AA)
    cv2.imwrite(str(destination / "clean.jpg"), filled, [cv2.IMWRITE_JPEG_QUALITY, 92])
    blurred = cv2.GaussianBlur(filled, (3, 3), 0.8)
    cv2.imwrite(str(destination / "blurred.jpg"), blurred,
                [cv2.IMWRITE_JPEG_QUALITY, 65])
    gradient = np.linspace(0.75, 1.1, filled.shape[1], dtype=np.float32)[None, :, None]
    uneven = np.clip(filled.astype(np.float32) * gradient, 0, 255).astype(np.uint8)
    cv2.imwrite(str(destination / "uneven.jpg"), uneven,
                [cv2.IMWRITE_JPEG_QUALITY, 78])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("blank", type=Path)
    parser.add_argument("annotation", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--seed", type=int, default=1919)
    args = parser.parse_args()
    generate(args.blank, args.annotation, args.output, args.seed)
