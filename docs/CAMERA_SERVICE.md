# Camera import service

The optional camera flow sends a full board photo to `camera_service`, which detects circle candidates, fits them to the six-neighbor paper lattice, and builds a single 4×5 contact sheet of 19 bubble interiors. The service calls handwriting OCR once for that sheet, then returns a reviewable proposal. The browser uses the existing paper scorer only after the player confirms positions and values. Manual scoring continues offline.

## Local development

Use Python 3.11, create a virtual environment, and install `camera_service/requirements.txt`. For service tests, also install `pytest` and `httpx`. Run from the repository root:

```sh
python -m venv .venv
.venv/bin/pip install -r camera_service/requirements.txt pytest httpx
CAMERA_ALLOWED_ORIGINS=http://127.0.0.1:5173 .venv/bin/uvicorn camera_service.app:app --host 127.0.0.1 --port 8080
```

In another shell, run the PWA with `VITE_CAMERA_ENDPOINT=http://127.0.0.1:8080/scan pnpm dev`. Without an OCR provider, geometry can be reviewed and values entered by hand. To use Google Cloud Vision, enable its API, provide Application Default Credentials with permission to call it, and set `CAMERA_OCR_PROVIDER=google-vision` on the service. A production build without `VITE_CAMERA_ENDPOINT` explains that scanning is unconfigured and retains manual scoring.

The container builds with `docker build -f camera_service/Dockerfile .`. It exposes `POST /scan` (raw JPEG, PNG, or WebP body with the matching `Content-Type`) and `GET /health`. The response schema is documented in `CAMERA_SCORER_SPEC.md`. A second call to the same `/scan` endpoint may include `X-Bubble-Geometry`, a JSON array of exactly 19 `{x,y,radius,q,r}` objects, after the player corrects the positions. The service validates image bounds, distinct connected axial positions, and the bubble count before making one contact-sheet OCR call. The default limits are 12 MiB encoded, 30 million decoded pixels, and a best-effort 30 requests/hour/client throttle. The service does not retain photos or OCR images. It disables HTTP access logs; configure platform logs to avoid request bodies.

## Production setup

Deploy the container on a serverless HTTPS service with request-based billing and zero minimum instances. Set `CAMERA_ALLOWED_ORIGINS` to the exact deployed Pages origin and `CAMERA_OCR_PROVIDER=google-vision`; set `VITE_CAMERA_ENDPOINT` to the HTTPS `/scan` URL when building the PWA. Keep Google credentials in the service identity, never in Vite variables. Enable a provider/project OCR usage quota and monitoring before exposing the endpoint. The local request throttle and CORS are not hard cost controls. Set a small maximum instance count and billing alerts as additional safeguards.

The public endpoint should be tested with the actual Pages origin, phone and iPad photo uploads, malformed and oversized images, OCR outage, and partial photographs. Record observed p50/p95 latency and OCR cost per scan. **No deployment or paid OCR use is part of this repository change.**

The original official-board photos and blank forms in local `sample_images/` and `blank_boards/` are evaluation references only. Do not include them or derivatives containing official artwork in the public repository or shipped app. Use independent, human-checked real photos to measure accuracy; synthetic cases only test known geometry and mapping.

For local synthetic fixtures, annotate a blank with a private JSON array of 19 circles containing `x`, `y`, `radius`, `q`, and `r`, then run `python -m camera_service.tools.synthesize_local blank.webp centers.json local-output`. The tool writes a fixed-seed ground-truth file and clean, blurred, and uneven-lighting images. Keep the output outside the repository because it contains the source artwork.

Current local evaluation is **not a release claim**. With the supplied references, the template-free detector produced an automatically reviewable 19-circle graph on three of six blank images, but none of the six filled photos. A local synthetic filled variant of one blank also required correction. The incomplete `gameplay-3-3.webp` correctly remained partial. The player can correct candidates and then request OCR for the corrected set. Automatic detection, OCR accuracy, latency, and cost still need the spec's human-checked evaluation set before deployment.
