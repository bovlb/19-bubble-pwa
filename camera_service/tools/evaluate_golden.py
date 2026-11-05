"""Compare local no-OCR camera proposals with private golden-answer JSON files.

Run: .venv/bin/python -m camera_service.tools.evaluate_golden \
  --photos-root /path/to/repo --answers /path/to/golden_answers
"""

from __future__ import annotations

import argparse
from collections import defaultdict
import json
import math
import os
from pathlib import Path


def match_centers(gold: list[dict], predicted: list[dict]) -> dict[int, int]:
    """One-to-one matches within 60% of the annotated bubble radius."""
    possible = []
    for i, first in enumerate(gold):
        for j, second in enumerate(predicted):
            distance = math.hypot(first["x"] - second["x"], first["y"] - second["y"])
            if distance <= max(8, first["radius"] * 0.6):
                possible.append((distance, i, j))
    matched: dict[int, int] = {}
    used = set()
    for _, i, j in sorted(possible):
        if i not in matched and j not in used:
            matched[i] = j
            used.add(j)
    return matched


def read_answers(folder: Path) -> dict[str, dict]:
    answers = {}
    for path in sorted(folder.glob("*.json")):
        data = json.loads(path.read_text())
        name = data.get("image")
        if not isinstance(name, str) or name in answers:
            raise ValueError(f"Missing or duplicate image key in {path}")
        if (not isinstance(data.get("circles"), list) or len(data["circles"]) != 19 or
                not isinstance(data.get("edges"), list)):
            raise ValueError(f"Golden answer needs 19 circles and edges: {path}")
        answers[name] = data
    if not answers:
        raise ValueError(f"No golden-answer JSON files in {folder}")
    return answers


def evaluate(photos_root: Path, answers_folder: Path) -> None:
    # The offline benchmark must never invoke a configured paid OCR provider.
    os.environ["CAMERA_REQUESTS_PER_HOUR"] = "10000"
    from fastapi.testclient import TestClient
    from camera_service.app import app
    app.state.ocr_client = None
    client = TestClient(app)
    answers = read_answers(answers_folder)
    totals = defaultdict(int)
    print("Photo | Type | Status | Circle centers | Correct edges / gold | Extra edges")
    print("--- | --- | --- | ---: | ---: | ---:")
    for name, gold in sorted(answers.items()):
        path = (photos_root / name).resolve()
        if not path.is_relative_to(photos_root.resolve()) or not path.is_file():
            raise ValueError(f"Photo not found under photos root: {name}")
        media = {".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                 ".png": "image/png", ".webp": "image/webp"}.get(path.suffix.lower())
        if media is None:
            raise ValueError(f"Unsupported photo type: {name}")
        response = client.post("/scan", content=path.read_bytes(), headers={"Content-Type": media})
        if response.status_code != 200:
            raise ValueError(f"Scan failed for {name}: HTTP {response.status_code}")
        proposal = response.json()
        matches = match_centers(gold["circles"], proposal["circles"])
        inverse = {predicted: original for original, predicted in matches.items()}
        gold_edges = {tuple(edge) for edge in gold["edges"]}
        proposed_edges = {tuple(sorted((inverse[a], inverse[b])))
                          for a, b in proposal["edges"] if a in inverse and b in inverse}
        correct = len(gold_edges & proposed_edges)
        extra = len(proposed_edges - gold_edges)
        kind = "completed game" if gold.get("complete") else "blank/unfinished"
        totals["photos"] += 1
        totals["matched"] += len(matches)
        totals["gold_edges"] += len(gold_edges)
        if proposal["status"] == "review":
            totals["review"] += 1
            totals["correct_edges"] += correct
            totals["extra_edges"] += extra
        edge_text = f"{correct}/{len(gold_edges)}" if proposal["status"] == "review" else "n/a"
        extra_text = str(extra) if proposal["status"] == "review" else "n/a"
        print(f"{name} | {kind} | {proposal['status']} | {len(matches)}/19 | {edge_text} | {extra_text}")
    print(f"\n{totals['review']}/{totals['photos']} automatic review proposals; "
          f"{totals['matched']}/{totals['photos'] * 19} annotated centers matched. "
          "Edge counts apply only to automatic review proposals. OCR was disabled.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--photos-root", type=Path, required=True)
    parser.add_argument("--answers", type=Path, required=True)
    args = parser.parse_args()
    evaluate(args.photos_root, args.answers)


if __name__ == "__main__":
    main()
