# Camera import service

The optional online camera flow uploads a full paper-board photo to `camera_service`. The service finds the card outline, rectifies perspective, detects ring candidates, and infers edges between nearly touching bubbles. There is no board catalog or axial-grid fit. Only a plausible, connected set of 19 bubbles is sent to handwriting OCR as one 4×5 contact sheet. The player reviews and corrects the board before the existing exact paper scorer runs. Manual scoring remains available offline.

## Local development

Use Python 3.11 or later, create a virtual environment, and install `camera_service/requirements.txt`, `pytest`, and `httpx`:

```sh
python -m venv .venv
.venv/bin/pip install -r camera_service/requirements.txt pytest httpx
CAMERA_ALLOWED_ORIGINS=http://127.0.0.1:5173 .venv/bin/uvicorn camera_service.app:app --host 127.0.0.1 --port 8080
```

Run the PWA with `VITE_CAMERA_ENDPOINT=http://127.0.0.1:8080/scan pnpm dev`. Without an OCR provider, detected bubbles can be reviewed and their values entered manually. For Google Cloud Vision, enable its API, provide Application Default Credentials, and set `CAMERA_OCR_PROVIDER=google-vision`. A production build without `VITE_CAMERA_ENDPOINT` explains that scanning is unconfigured.

The container builds with `docker build -f camera_service/Dockerfile .`. It exposes `POST /scan` (raw JPEG, PNG, or WebP body with matching `Content-Type`) and `GET /health`. The schema 2 response contains the original image dimensions, four board corners, circles, proximity edges, values, and warnings. A repeat call may include `X-Board-Corners` (four `[x,y]` points) to rerun detection after corner correction, and `X-Bubble-Geometry` (19 `{x,y,radius}` objects) to read the corrected bubble interiors. The service validates bounds, distinct bubbles, and graph connectivity before paid OCR. Limits are 12 MiB encoded, 30 million decoded pixels, and a best-effort 30 requests/hour/client throttle.

## Production setup

Deploy as a serverless HTTPS container with request-based billing and zero minimum instances. Set `CAMERA_ALLOWED_ORIGINS` to the Pages origin and `CAMERA_OCR_PROVIDER=google-vision`; build the PWA with the HTTPS `/scan` URL in `VITE_CAMERA_ENDPOINT`. Keep provider credentials in the service identity. Set a provider/project OCR quota, a small maximum instance count, and billing alerts. Local throttling and CORS are not hard spending caps. The service does not retain photos or contact sheets; configure platform logs to avoid request bodies.

**This change does not deploy the service or enable paid OCR.** The supplied photos are local evaluation references and are not committed or shipped. The detector still requires manual correction on many filled photos; do not publish automatic accuracy claims until a human-checked evaluation set measures circle, edge, and OCR quality separately.

In a local no-OCR run on the 12 supplied images, the service returned reviewable geometry for 2 of 6 blank references and 1 of 6 filled photos. The remaining 9 stayed partial, including `gameplay-3-3.webp`. Its score area is cropped, but the golden answer identifies 19 bubbles. These are detector status counts, not verified circle/edge accuracy measurements.

## Create a private golden answer set

Run the local annotation page with the paths to your private photo folders:

```sh
.venv/bin/python -m camera_service.tools.golden_labeler --images /path/to/sample_images --images /path/to/blank_boards
```

Open `http://127.0.0.1:8765`. The page starts with the detector's proposal. It keeps at most 19 active bubbles; extra detections are hidden until **Show spare suggestions** is chosen. Remove an incorrect bubble, then click a gray spare to use it. Drag circles to their true centers, adjust radii, and enter the written values. **Apply to all radii** and **Clear all values** support bulk edits. Choose **Edit connections** and click two bubbles to toggle their adjacency. Drag the four board-corner handles, edit their X/Y fields if a handle is outside the photo, or reset all corners to the image bounds. Export one `.golden.json` per image; the file contains coordinates, corners, edges, values, a completed-game flag, and notes, but no photo pixels. The flag describes whether the game was played to completion; it does not determine whether the photo shows all 19 bubble outlines. Use **Resume from JSON** to continue an exported answer. Browser-local edits also survive a reload. The labeler binds only to loopback and disables paid OCR even when the normal service has an OCR provider configured. Keep these answers private alongside the supplied photos; do not commit official-board derivatives to the public repository.

When the private folder has one answer per photo, compare the detector with those annotations:

```sh
.venv/bin/python -m camera_service.tools.evaluate_golden --photos-root /path/to/19-bubble-pwa --answers /path/to/19-bubble-pwa/golden_answers
```

The report shows one-to-one circle-center matches, automatic-review status, and edge agreement for review proposals. It disables OCR. The `complete` field groups completed games separately from blank or unfinished boards; it is not a geometry filter.

With the first 12 user-labeled answers, the current detector produced 3 automatic review proposals and matched 147 of 228 annotated bubble centers using a tolerance of 60% of each annotated radius. Among the three review proposals, it matched all 91 annotated edges and added one extra edge. These figures are a small local regression baseline, not a release accuracy claim; OCR was not evaluated.
