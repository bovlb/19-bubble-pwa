# Camera scorer specification

Status: implementation draft; release evaluation pending · 2026-11-04

The camera scorer is an optional online import into the existing manual paper scorer. It accepts a photograph of one official 19-bubble board of any layout. The user reviews the proposed circles, connections, and values before scoring. The existing deterministic game and exact scoring rules remain unchanged. Official board artwork is neither bundled nor shipped.

## User flow

From **Score a paper game**, the player chooses **Scan a paper board**, takes or uploads a JPEG, PNG, or WebP photo, and explicitly submits it. The full photo is sent to the camera service; only cropped bubble interiors are sent to handwriting OCR. The review shows the original photo, four board corners, candidate circles, proximity connections, and editable numbers. The player may move any corner and rerun detection; add, remove, move, or resize circles; and correct each value. A blank or unreadable value is `null`, distinct from zero. When exactly 19 distinct connected bubbles are present, the user can confirm and continue in the existing paper scorer or request a second OCR pass over corrected circles. Values already entered by the player survive that pass.

Partial detections remain editable and cannot be confirmed as a complete board. A photo missing any bubble or containing an ambiguous circle set must not be silently promoted to a complete result. Cropping outside the bubble region does not by itself make a board incomplete. Upload failures do not alter saved paper drafts. Manual scoring remains available without connectivity or a configured camera service.

## Geometry and OCR pipeline

1. Apply EXIF orientation. Detect the board/card quadrilateral and rectify perspective. If the outline cannot be found, return the full-image corners with a warning; the user can correct the corners and rerun detection.
2. Detect candidate circular outlines in the rectified image, merge duplicate rings, and retain confidence. Select 19 only when the proposed set has consistent ring sizes, no severe overlap, a connected proximity graph, plausible edge count, and at most six neighbors per bubble. Keep candidates for correction otherwise. Never manufacture a missing circle.
3. Infer each edge from near contact between circle boundaries; no printed connection line, fixed nearest-neighbor count, board template, or axial lattice is assumed. Use the rectified geometry for adjacency, including after user corrections.
4. Crop the 19 interiors, place them on one 4×5 contact sheet with gutters, and submit one OCR image. Map OCR boxes to tiles. Accept only integers 0–30; ambiguous, conflicting, missing, or invalid readings become `null`. OCR is never used to infer shape or score.
5. Return a reviewable proposal. Scoring remains in the existing worker after explicit confirmation.

The HTTP endpoint accepts an image body up to 12 MiB and 30 million decoded pixels. `X-Board-Corners` can supply four image-space points for a detection retry. `X-Bubble-Geometry` can supply 19 corrected `{x,y,radius}` objects for an OCR retry; the service validates distinctness and connectivity before OCR. The response is schema 2:

```json
{
  "schema": 2,
  "status": "review",
  "image": { "width": 3000, "height": 2000 },
  "boardCorners": [[20, 15], [2980, 20], [2990, 1980], [15, 1990]],
  "circles": [{
    "id": "c0", "x": 453, "y": 382, "radius": 71,
    "value": 7, "detectionConfidence": 0.96, "ocrStatus": "read"
  }],
  "edges": [],
  "warnings": []
}
```

The example is abbreviated. `status` is `review` only for a plausible connected 19-circle set; otherwise `partial`. The browser validates schema, bounds, IDs, values, and graph shape. A confirmed camera board is saved and shared as a version 2 explicit-graph token: 19 normalized coordinates and an edge list with checksum. Version 1 axial-grid tokens and existing saved boards remain readable. Values remain local to the device and are not included in shared links.

## Privacy, costs, and release criteria

The endpoint is stateless. Do not persist originals, crops, or OCR text in application storage or logs. Keep provider credentials server-side. Use provider/project OCR quota, low instance limits, and billing alerts; CORS and an instance-local throttle alone do not cap cost. Google Cloud Vision is the initial optional OCR adapter, but provider accuracy and price must be measured before launch. No paid OCR or deployment is authorized by this implementation.

Unit tests must cover perspective mapping, proximity edges, incomplete or duplicate circles, contact-sheet indexing, OCR ambiguity, explicit-graph links, and version 1 compatibility. Browser tests must cover review, correction, import, local save, and reload. Evaluate all supplied samples locally, including the cropped `gameplay-3-3.webp`, and then at least 30 additional human-checked real photos across layouts, handwriting, and camera angles. Report circle, edge, and OCR accuracy separately, plus correction rate and time. Synthetic variants may support geometry regressions but cannot establish handwriting accuracy; derivatives of official artwork stay local. Release only after the complete flow is reliable on that evaluation set and operating cost is measured.
