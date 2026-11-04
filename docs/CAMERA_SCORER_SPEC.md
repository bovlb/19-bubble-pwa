# Camera import for paper scoring — implementation specification

Status: implementation draft; release evaluation pending · 2026-11-04 · Scope: camera import for the existing manual paper scorer

## 1. Purpose and relationship to the existing app

Add an optional, internet-only **Scan a paper board** flow that turns a photograph of a filled 19-bubble board into a *proposed* board shape and values. The player reviews and corrects the proposal before the existing exact paper scorer calculates a score. Support any official board layout without a board catalog or selection step. Do not bundle or reproduce official board artwork.

This document specifies the camera extension only. The player protocol, rules, and exact scorer in `SPEC.md` remain authoritative. The earlier exclusion of photographic recognition in `SPEC.md` applies to the original player scope and is superseded for this optional extension. Camera input never changes the game's deterministic challenge protocol or scoring algorithm.

The current paper scorer is the integration target:

- `src/paper.ts` represents a shape as exactly 19 distinct, connected axial lattice positions, normalizes them, and derives every six-neighbor edge with `paperGraph`.
- `src/PaperScoring.tsx` accepts integers 0–30 or `null` for unfilled bubbles and sends the resulting graph and values to `src/scorer.worker.ts`.
- Paper board links and local drafts store a shape and values, respectively. A scan must use these existing paths after review; camera-specific image coordinates or confidence scores are not part of the shape token.

## 2. Product behavior

From **Score a paper game**, the player can choose **Scan board**, use the device camera or upload a photo, and explicitly submit it for online processing. The app shows upload/processing progress. The server returns detected circle locations, a proposed 19-position lattice shape, inferred neighbor edges, and proposed values. The app shows that proposal over the original photo and on the existing paper grid. The player can:

1. Add, remove, or reposition a detected bubble so that exactly 19 distinct bubbles correspond to the paper sheet.
2. Correct a bubble's lattice position and inspect all induced edges. Changing a lattice position updates its neighbor connections. Provide a clear path into the existing manual shape editor if the proposed geometry cannot be repaired in the photo overlay.
3. Edit each value, including clearing it. `null` means missing, unreadable, or unfilled; it is never interpreted as zero. A confirmed 0 is the integer zero.
4. Confirm the board and continue in the existing manual scorer. Confirmation validates the shape with `normalizeShape`, derives edges with `paperGraph`, and uses the existing score worker. Do not create a separate photographic scoring calculation.

If automatic geometry is partial, the player may correct all 19 bubbles and explicitly re-upload the photo to the same endpoint for targeted OCR. The service must validate the corrected positions before calling the OCR provider. Values the player already entered remain intact.

The app must not silently save or score an unreviewed proposal as final. It may show a provisional score during review only if clearly labeled and based on the same exact scorer. If processing fails or the user declines to upload, manual shape and value entry remain available. The camera flow requires connectivity; the current manual scorer remains offline-capable.

The first release supports one complete board per photograph. A cropped photograph or one with multiple plausible boards should produce a recoverable partial proposal or a request to retake, never an invented complete board. The player may still use the returned partial detection as a starting point for manual correction.

## 3. Input and image evidence

The six locally supplied `sample_images/` files are development references, not application assets or public test fixtures. They show at least three distinct layouts, perspective distortion, uneven illumination, colored artwork, hand-drawn marks crossing circle outlines, double-traced circles, shaded interiors, and printed score boxes or other non-bubble grids. `gameplay-3-3.webp` does not show a complete board and must exercise the incomplete-photo path. The supplied `blank_boards/` files include three blank layouts plus alternate framing and perspective of one layout. Use them locally to create deterministic synthetic filled boards with known circle positions and values. Do not commit these official-board images or derived images containing their artwork to the camera feature PR or ship them in the PWA.

The photo intake accepts JPEG, PNG, and WebP. Set explicit limits for encoded bytes, decoded dimensions, and processing time before deployment; reject unsupported or oversized input with a specific user-facing error. Apply EXIF orientation and make the displayed review overlay use the same normalized image coordinates as the server response. Preserve enough resolution for one- and two-digit handwriting; reducing the whole sheet to a tiny thumbnail before detection is not acceptable.

## 4. Server processing pipeline

Use one stateless serverless HTTPS endpoint. A container-based runtime is the default because circle detection and image rectification may need native image-processing libraries. The server receives the full photograph and performs these stages:

1. **Find the board region.** Correct image orientation and estimate a perspective transform where possible. Ignore decorative or scoring grids outside the bubble region. Record whether the full board appears visible.
2. **Detect circle candidates.** Find bubble-like rings across expected sizes and line weights. Merge duplicate detections of a double-traced ring. Retain location, size, and detection confidence for each candidate; do not force the count to 19 by fabricating circles or silently dropping ambiguous candidates.
3. **Select and fit 19 positions.** Choose the best coherent group of circle candidates and fit centers to a six-neighbor triangular lattice. The fit can rotate, scale, shear, and account for photo perspective. Return axial `(q,r)` coordinates for the selected centers. Reject duplicate positions. The photographed circles are nearly touching; adjacency is between neighboring lattice positions, without printed connecting lines. Derive edges from the six offsets used by `paperGraph`, rather than a fixed count of nearest neighbors or a generic triangulation that may bridge gaps. Require a connected graph before enabling confirmation.
4. **Prepare targeted OCR.** Crop the *interior* of each selected bubble while preserving the entire handwritten digit or two-digit number and reducing border/artwork interference. Arrange the 19 crops in a fixed 4×5 contact sheet with wide blank gutters and one unused cell. Keep tile-to-circle IDs in server metadata; do not print labels or indexes in the image. Send one contact-sheet image for handwriting OCR. Map returned text boxes to tiles by coordinates. A recognized numeral must be an integer 0–30; a missing, conflicting, or out-of-range reading becomes `null` with a warning. Never infer a value from game rules or score arithmetic.
5. **Return a proposal.** Include the image-space candidate circles, selected tile IDs, lattice positions, induced edges, proposed values, and per-item review flags. Distinguish detection uncertainty from OCR uncertainty. No score is returned by the endpoint.

OCR provider is a deployment choice. Google Cloud Vision `DOCUMENT_TEXT_DETECTION` is the initial candidate because one contact sheet is one billable image; a vision language model may be evaluated against it. Do not claim a provider is accurate enough until measured on relevant photos. Keep the OCR adapter replaceable without changing the client contract.

## 5. Endpoint contract and validation

Use a versioned JSON response such as:

```json
{
  "schema": 1,
  "status": "review",
  "image": { "width": 3000, "height": 2000 },
  "circles": [
    {
      "id": "c0",
      "x": 453,
      "y": 382,
      "radius": 71,
      "q": 0,
      "r": 0,
      "value": 7,
      "detectionConfidence": 0.96,
      "ocrStatus": "read"
    }
  ],
  "edges": [],
  "warnings": []
}
```

The example is illustrative, not a 19-circle fixture. `status` is `review` when a valid 19-node connected candidate exists and `partial` otherwise. For a partial response, some circles may lack lattice coordinates and OCR values; preserve candidates so the client can support correction. The response includes stable per-response IDs and finite coordinates inside the normalized image, with bounded radii and confidence values. `value` is an integer 0–30 or `null`; `ocrStatus` distinguishes read, uncertain, and unreadable. Reject unsupported schema versions, malformed numbers, duplicate IDs or lattice positions, inconsistent edges, and oversized responses on the client. Treat all server data as untrusted until the paper module validates the corrected shape and values.

The request is a single image upload with a maximum size and a client-generated request ID for tracing failures without logging photo contents. Return explicit errors for unsupported file, too large, unreadable image, no complete board, OCR unavailable, rate limit, and temporary server failure. Errors must not replace or corrupt an existing paper draft. Ignore stale responses if the user selects a different photo or leaves the flow.

## 6. Privacy, operating cost, and deployment

The app is a static GitHub Pages PWA; the scan endpoint is the only new online service. Upload requires an explicit user action and a short disclosure that the full photo goes to the endpoint and cropped interiors go to the OCR provider. Do not persist originals, contact sheets, or handwriting crops in application storage or server logs. Hold them only as needed for processing, then discard them. Save only the confirmed shape and values through the existing paper-draft mechanism. Document the selected provider's data handling before release.

Keep provider credentials on the server. Restrict accepted file types, size, pixel count, request duration, and response size. CORS may allow the deployed app origin, but it is not authentication; a publicly callable endpoint still needs abuse controls. Use a low initial concurrency/instance limit, per-client throttling where practical, and a provider quota or equivalent enforceable OCR usage limit. Record scan count, processing time, error class, OCR calls, and estimated cost without image or recognized-number content. Set billing alerts; do not describe alerts alone as a hard spending cap. No account or photo database is required for the first release.

Configure the endpoint URL for the deployed Pages base path without exposing secrets in frontend code. Development and preview builds must be able to use a non-production endpoint or mock. Do not deploy the endpoint or turn on paid OCR until the owner authorizes deployment. Manual scoring and player functionality must continue when the endpoint is absent or down.

## 7. Verification and release gates

1. **Geometry:** Automated tests cover clean and noisy synthetic 19-circle layouts, rotation, scale, perspective, duplicate outlines, nearby decorative circles, missing circles, extra candidates, and a cropped board. Verify that corrected lattice coordinates yield exactly the `paperGraph` edges and that generic nearest-neighbor bridging is rejected.
2. **OCR mapping:** Test the 4×5 contact-sheet builder and coordinate mapping with a fake OCR response. Each recognized box maps to at most one tile; no value can migrate to a neighboring bubble. Test 0, 1, 10, 30, blank, invalid text, duplicate/conflicting text, and a clipped digit. Confirm one OCR image is submitted per scan attempt under the selected adapter.
3. **Integration:** A reviewed import creates a normal paper draft, with the same shape token, value validation, local save behavior, and exact score as entering the identical shape and values manually. Test correction of missing/extra circles, lattice positions, induced edges, and values; stale responses and failed uploads do not mutate saved drafts.
4. **Synthetic image suite:** On each blank layout, render known 0–30 values into the 19 interiors, with a saved ground-truth file for circle centers, axial positions, edges, and values. Vary digit width, stroke weight, rotation, placement, contrast, blur, compression, lighting, and perspective. Generate missing or illegible entries and a cropped-board case. Fix random seeds so every generated case is reproducible. Use these for geometry, contact-sheet, and OCR-mapping regression tests, while keeping derivatives of official artwork local rather than committing them. Printed or simulated handwriting does not establish real handwriting accuracy.
5. **Real-photo evaluation:** Establish human-checked ground truth for the supplied samples and at least 30 additional photos covering several board layouts, handwriting styles, lighting conditions, and camera angles. Keep official artwork out of shipped assets and public fixtures. Report circle detection, lattice/edge, and OCR accuracy separately, plus the fraction of boards needing correction and median time to confirm. Record failures rather than silently excluding them. The cropped reference image must be reported as incomplete. Do not claim automatic accuracy from synthetic tests alone.
6. **Operational:** Verify file and decompression limits, invalid image handling, provider outage, rate/usage limits, secret handling, CORS, and no image content in logs. Record measured p50/p95 latency and actual provider cost per scan on the evaluation set. Verify the Pages app still works offline in manual mode and presents a clear online requirement for Scan board.

The feature is ready for review when a user can scan any supported full board, correct the proposal, and get the same exact score as manual entry; errors and incomplete photos remain recoverable; and measured accuracy, latency, privacy behavior, and running cost are documented. A later release may add board-specific templates if the template-free results justify them, but none are required for the first version.
