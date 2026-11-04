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

In a local no-OCR run on the 12 supplied images, the service returned reviewable geometry for 2 of 6 blank references and 1 of 6 filled photos. The remaining 9 stayed partial, including the cropped `gameplay-3-3.webp`. These are status counts, not verified circle/edge accuracy measurements.
