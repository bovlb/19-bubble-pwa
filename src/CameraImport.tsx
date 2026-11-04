import React, { useEffect, useRef, useState } from "react";
import {
  cameraEdges,
  cameraToPaper,
  validateCameraProposal,
  type CameraCircle,
  type CameraProposal,
} from "./camera";
import type { Point } from "./paper";

const endpoint =
  (window as Window & { __CAMERA_ENDPOINT__?: string }).__CAMERA_ENDPOINT__ ??
  import.meta.env.VITE_CAMERA_ENDPOINT ??
  "";

export function CameraImport({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (result: {
    points: Point[];
    values: (number | null)[];
    token: string;
  }) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [photo, setPhoto] = useState("");
  const [proposal, setProposal] = useState<CameraProposal | null>(null);
  const [circles, setCircles] = useState<CameraCircle[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"select" | "move" | "add">("select");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const selectedCircle = circles.find((c) => c.id === selected);
  const edges = cameraEdges(circles);
  let shapeError = "";
  try {
    cameraToPaper(circles);
  } catch (e) {
    shapeError = (e as Error).message;
  }
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    const refresh = () => setOnline(navigator.onLine);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
    };
  }, []);
  useEffect(() => {
    if (!file) {
      setPhoto("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPhoto(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  function choose(next: File | null) {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setFile(next);
    setProposal(null);
    setCircles([]);
    setSelected(null);
    setMode("select");
    setError("");
  }
  async function analyze(corrected = false) {
    if (!file || !endpoint) return;
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    setBusy(true);
    setError("");
    try {
      const headers: Record<string, string> = {
        "Content-Type": file.type,
        "X-Request-ID": crypto.randomUUID(),
      };
      if (corrected) {
        cameraToPaper(circles);
        headers["X-Bubble-Geometry"] = JSON.stringify(
          circles.map(({ x, y, radius, q, r }) => ({ x, y, radius, q, r })),
        );
      }
      const response = await fetch(endpoint, {
        method: "POST",
        body: file,
        headers,
        signal: abort.signal,
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const message =
          data &&
          typeof data === "object" &&
          "message" in data &&
          typeof data.message === "string"
            ? data.message
            : "Camera processing failed. Try another photo.";
        throw Error(message);
      }
      if (abort.signal.aborted) return;
      const checked = validateCameraProposal(data);
      setProposal(checked);
      setCircles(
        corrected
          ? checked.circles.map((circle, i) =>
              circles[i]?.value != null
                ? {
                    ...circle,
                    value: circles[i].value,
                    ocrStatus: circles[i].ocrStatus,
                  }
                : circle,
            )
          : checked.circles,
      );
      setSelected(checked.circles[0]?.id ?? null);
    } catch (e) {
      if (!abort.signal.aborted)
        setError(e instanceof Error ? e.message : "Camera processing failed.");
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  function update(id: string, change: Partial<CameraCircle>) {
    setCircles((current) =>
      current.map((c) => (c.id === id ? { ...c, ...change } : c)),
    );
  }
  function photoClick(event: React.MouseEvent<HTMLImageElement>) {
    if (mode === "select" || !proposal) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.round(
      ((event.clientX - bounds.left) / bounds.width) * proposal.image.width,
    );
    const y = Math.round(
      ((event.clientY - bounds.top) / bounds.height) * proposal.image.height,
    );
    if (mode === "move" && selected) update(selected, { x, y });
    if (mode === "add") {
      const id = `added-${crypto.randomUUID()}`;
      const radii = circles.map((c) => c.radius).sort((a, b) => a - b);
      setCircles((current) => [
        ...current,
        {
          id,
          x,
          y,
          radius: radii[Math.floor(radii.length / 2)] ?? 40,
          q: null,
          r: null,
          value: null,
          detectionConfidence: 0,
          ocrStatus: "unreadable",
        },
      ]);
      setSelected(id);
    }
    setMode("select");
  }
  function confirm() {
    try {
      onConfirm(cameraToPaper(circles));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="card camera" aria-label="Scan a paper board">
      <h2>Scan a paper board</h2>
      <p>
        The full photo is sent to the camera service. It sends cropped bubble
        interiors to handwriting OCR. Review every result before scoring.
      </p>
      <div className="paper-actions">
        <label>
          Take photo
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
          />
        </label>
        <label>
          Upload photo
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
          />
        </label>
        <button onClick={onClose}>Back to manual entry</button>
      </div>
      {!endpoint && (
        <p role="status">
          Camera processing is not configured for this build. Manual scoring is
          available.
        </p>
      )}
      {file && (
        <p>
          {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
        </p>
      )}
      {file && file.size > 12 * 1024 * 1024 && (
        <p role="alert">Choose a photo under 12 MB.</p>
      )}
      <button
        disabled={
          !endpoint || !file || file.size > 12 * 1024 * 1024 || busy || !online
        }
        onClick={() => analyze()}
      >
        {busy ? "Analyzing photo…" : "Analyze photo online"}
      </button>
      {!online && (
        <p role="status">
          Connect to the internet to scan. Manual scoring remains available.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {proposal && (
        <>
          <h3>Review the proposed board</h3>
          <p role="status">
            {circles.length} circles selected.{" "}
            {shapeError || "All 19 positions form a connected board."}
          </p>
          {proposal.warnings.map((warning, i) => (
            <p role="status" key={i}>
              {warning}
            </p>
          ))}
          <p>
            Choose a circle to edit it. Use Move or Add, then tap its location
            in the photo. Connections follow neighboring grid positions.
          </p>
          <div
            className="camera-photo"
            style={{
              aspectRatio: `${proposal.image.width} / ${proposal.image.height}`,
            }}
          >
            {photo && (
              <img
                src={photo}
                alt="Uploaded paper board"
                onClick={photoClick}
              />
            )}
            <svg
              viewBox={`0 0 ${proposal.image.width} ${proposal.image.height}`}
              aria-hidden="true"
            >
              {edges.map(([a, b]) => (
                <line
                  key={`${a}-${b}`}
                  x1={circles[a].x}
                  y1={circles[a].y}
                  x2={circles[b].x}
                  y2={circles[b].y}
                />
              ))}
            </svg>
            {circles.map((circle, i) => (
              <button
                key={circle.id}
                type="button"
                className={circle.id === selected ? "selected" : ""}
                aria-label={`Select detected bubble ${i + 1}`}
                aria-pressed={circle.id === selected}
                style={{
                  left: `${(circle.x / proposal.image.width) * 100}%`,
                  top: `${(circle.y / proposal.image.height) * 100}%`,
                }}
                onClick={() => {
                  setSelected(circle.id);
                  setMode("select");
                }}
              >
                {circle.value ?? "?"}
              </button>
            ))}
          </div>
          <div className="paper-actions">
            <button disabled={!selectedCircle} onClick={() => setMode("move")}>
              Move selected circle
            </button>
            <button onClick={() => setMode("add")}>Add missing circle</button>
            <button
              disabled={!selectedCircle}
              onClick={() => {
                setCircles((current) =>
                  current.filter((c) => c.id !== selected),
                );
                setSelected(null);
                setMode("select");
              }}
            >
              Remove selected circle
            </button>
          </div>
          {mode !== "select" && (
            <p role="status">
              Tap the photo to{" "}
              {mode === "move" ? "move the selected circle" : "add a circle"}.
            </p>
          )}
          {selectedCircle && (
            <div className="camera-fields">
              <h4>Bubble {circles.indexOf(selectedCircle) + 1}</h4>
              <label>
                Photo X
                <input
                  type="number"
                  min="0"
                  max={proposal.image.width}
                  value={selectedCircle.x}
                  onChange={(e) =>
                    update(selectedCircle.id, { x: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                Photo Y
                <input
                  type="number"
                  min="0"
                  max={proposal.image.height}
                  value={selectedCircle.y}
                  onChange={(e) =>
                    update(selectedCircle.id, { y: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                Grid q
                <input
                  type="number"
                  min="-36"
                  max="36"
                  value={selectedCircle.q ?? ""}
                  onChange={(e) =>
                    update(
                      selectedCircle.id,
                      e.target.value === ""
                        ? { q: null, r: null }
                        : {
                            q: Number(e.target.value),
                            r: selectedCircle.r ?? 0,
                          },
                    )
                  }
                />
              </label>
              <label>
                Grid r
                <input
                  type="number"
                  min="-36"
                  max="36"
                  value={selectedCircle.r ?? ""}
                  onChange={(e) =>
                    update(
                      selectedCircle.id,
                      e.target.value === ""
                        ? { q: null, r: null }
                        : {
                            r: Number(e.target.value),
                            q: selectedCircle.q ?? 0,
                          },
                    )
                  }
                />
              </label>
              <label>
                Number (0–30 or blank)
                <input
                  type="number"
                  min="0"
                  max="30"
                  inputMode="numeric"
                  value={selectedCircle.value ?? ""}
                  onChange={(e) =>
                    update(selectedCircle.id, {
                      value:
                        e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </label>
              <p>
                OCR: {selectedCircle.ocrStatus}. Check the photo before
                confirming.
              </p>
            </div>
          )}
          <button
            disabled={!!shapeError || !online || busy || !endpoint}
            onClick={() => analyze(true)}
          >
            Read numbers from corrected circles online
          </button>
          <p>
            This re-uploads the photo and fills blank readings. Values you
            entered are kept.
          </p>
          <button className="primary" disabled={!!shapeError} onClick={confirm}>
            Use this board in manual scorer
          </button>
          {shapeError && (
            <p>
              You can also return to manual entry and build the shape on its
              grid.
            </p>
          )}
        </>
      )}
    </section>
  );
}
