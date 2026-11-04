import React, { useEffect, useRef, useState } from "react";
import {
  decodeShape,
  decodePaperGraph,
  encodeShape,
  paperGraph,
  paperStorageKey,
  readPaperDrafts,
  readShapeRoute,
  shapeLink,
  type PaperDraft,
  type Point,
} from "./paper";
import type { Certificate } from "./engine/score";
import { share } from "./sharing";
import { CameraImport } from "./CameraImport";
import type { Graph } from "./engine/rules";

export function PaperScoring({
  token,
  onHome,
}: {
  token: string;
  onHome: () => void;
}) {
  const [points, setPoints] = useState<Point[]>([]),
    [size, setSize] = useState(8),
    [name, setName] = useState("");
  const [draft, setDraft] = useState<PaperDraft | null>(null),
    [saved, setSaved] = useState<PaperDraft[]>([]);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [shared, setShared] = useState("");
  const [certificate, setCertificate] = useState<Certificate | null>(null),
    [highlight, setHighlight] = useState<number[]>([]);
  const [blocked, setBlocked] = useState(false);
  const [cameraMode, setCameraMode] = useState(false);
  const worker = useRef<Worker | null>(null),
    revision = useRef(0),
    fields = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => {
    let records: PaperDraft[] = [];
    try {
      records = readPaperDrafts();
      setSaved(records);
    } catch {
      setBlocked(true);
      setError(
        "Saved paper boards could not be read. They have been retained. You can still create, share, and score a board, but changes will not be saved.",
      );
    }
    if (token) {
      try {
        const imported = readShapeRoute(token);
        setPoints(imported.points);
        const existing = records.find((d) => d.token === imported.token);
        setDraft(
          existing ?? {
            id: crypto.randomUUID(),
            token: imported.token,
            name: imported.name || "Paper board",
            values: Array(19).fill(null),
            updated: Date.now(),
          },
        );
        if (existing)
          setNotice(
            "Resumed your saved numbers. Start a fresh score for another paper game.",
          );
      } catch (e) {
        setError((e as Error).message);
      }
    }
    const w = new Worker(new URL("./scorer.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = w;
    w.onmessage = (e) => {
      if (e.data.revision === revision.current) {
        if (e.data.error) setError(e.data.error);
        else setCertificate(e.data.certificate);
      }
    };
    w.onerror = () =>
      setError("Scoring could not finish. Reload to try again.");
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, [token]);
  useEffect(() => {
    setCertificate(null);
    setHighlight([]);
    const current = ++revision.current;
    if (draft)
      worker.current?.postMessage({
        revision: current,
        graph: decodePaperGraph(draft.token),
        values: draft.values,
      });
  }, [draft]);
  function store(next: PaperDraft, open = true) {
    if (open) setDraft(next);
    if (blocked) return;
    try {
      // Read again to preserve other drafts saved in another tab.
      const records = [
        next,
        ...readPaperDrafts().filter((d) => d.id !== next.id),
      ];
      localStorage.setItem(paperStorageKey, JSON.stringify(records));
      setSaved(records);
      setError("");
      setNotice("Saved on this device");
    } catch {
      setError(
        "Could not save this paper score. Keep this page open and try Save again.",
      );
    }
  }
  let shape = "",
    shapeError = "";
  try {
    shape = encodeShape(points);
  } catch (e) {
    shapeError = (e as Error).message;
  }
  const graph = draft ? decodePaperGraph(draft.token) : paperGraph(points);
  const positions = draft?.token.startsWith("2.")
    ? graph.coordinates.map(([x, y]) => [x * 0.45, y * 0.45])
    : points.map(([q, r]) => [56 * (q + r / 2), 49 * r]);
  const minX = Math.min(0, ...positions.map((p) => p[0])),
    minY = Math.min(0, ...positions.map((p) => p[1]));
  const width = Math.max(0, ...positions.map((p) => p[0])) - minX + 60,
    height = Math.max(0, ...positions.map((p) => p[1])) - minY + 60;
  function fresh() {
    const next = {
      id: crypto.randomUUID(),
      token: draft?.token ?? shape,
      name: draft?.name ?? (name.trim() || "Paper board"),
      values: Array(19).fill(null),
      updated: Date.now(),
    };
    if (!draft) setPoints(decodeShape(shape));
    store(next);
    history.replaceState(null, "", shapeLink(next.token, next.name));
  }
  async function shareBoard() {
    const link = shapeLink(draft?.token ?? shape, draft?.name ?? name);
    setShared(link);
    if (
      !draft &&
      !saved.some(
        (d) => d.token === shape && d.name === (name.trim() || "Paper board"),
      )
    ) {
      store(
        {
          id: crypto.randomUUID(),
          token: shape,
          name: name.trim() || "Paper board",
          values: Array(19).fill(null),
          updated: Date.now(),
        },
        false,
      );
    }
    try {
      setNotice(await share(link));
    } catch {
      setNotice("Copy the board link below.");
    }
  }
  function useCameraBoard(result: {
    graph: Graph;
    values: (number | null)[];
    token: string;
  }) {
    const next: PaperDraft = {
      id: crypto.randomUUID(),
      token: result.token,
      name: name.trim() || "Scanned board",
      values: result.values,
      updated: Date.now(),
    };
    setPoints([]);
    setCameraMode(false);
    store(next);
    history.replaceState(null, "", shapeLink(next.token, next.name));
  }
  return (
    <main className="paper">
      <header>
        <button onClick={onHome}>← Home</button>
        <h1>Score a paper game</h1>
      </header>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      <p role="status">{notice}</p>
      <p>Create a board → Share its shape → Enter your numbers</p>
      {!draft && cameraMode ? (
        <CameraImport
          onClose={() => setCameraMode(false)}
          onConfirm={useCameraBoard}
        />
      ) : !draft ? (
        <section className="card">
          <h2>Create board</h2>
          <button onClick={() => setCameraMode(true)}>
            Scan a paper board
          </button>
          <label>
            Shape name (optional)
            <input
              maxLength={80}
              value={name}
              placeholder="e.g. Sunday’s board"
              onChange={(e) => {
                setName(e.target.value);
                setShared("");
              }}
            />
          </label>
          <p>
            Tap the 19 positions that match your paper. Neighboring bubbles
            connect automatically.
          </p>
          <p role="status">
            {points.length} of 19 selected. {shapeError}
          </p>
          <div
            className="paper-scroll"
            tabIndex={0}
            aria-label="Board shape grid; scroll to see more positions"
          >
            <div
              className="shape-grid"
              style={{ width: size * 56 + 32, height: size * 49 + 12 }}
            >
              <svg aria-hidden="true" width="100%" height="100%">
                {graph.edges.map(([a, b]) => {
                  const [q, r] = points[a],
                    [s, t] = points[b];
                  return (
                    <line
                      key={`${a}-${b}`}
                      x1={56 * (q + r / 2) + 28}
                      y1={49 * r + 28}
                      x2={56 * (s + t / 2) + 28}
                      y2={49 * t + 28}
                    />
                  );
                })}
              </svg>
              {Array.from({ length: size * size }, (_, i) => {
                const row = Math.floor(i / size),
                  col = i % size,
                  q = col - Math.floor(row / 2);
                const selected = points.some(([x, y]) => x === q && y === row);
                return (
                  <button
                    key={i}
                    className="shape-dot"
                    style={{ left: col * 56 + (row % 2) * 28, top: row * 49 }}
                    aria-label={`Row ${row + 1}, column ${col + 1}`}
                    aria-pressed={selected}
                    disabled={!selected && points.length === 19}
                    onClick={() => {
                      setShared("");
                      setPoints(
                        selected
                          ? points.filter(([x, y]) => x !== q || y !== row)
                          : [...points, [q, row]],
                      );
                    }}
                  >
                    {selected ? "●" : "+"}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="paper-actions">
            <button
              disabled={size >= 19}
              onClick={() => setSize(Math.min(19, size + 2))}
            >
              Expand grid
            </button>
            <button
              disabled={!points.length}
              onClick={() => {
                setPoints([]);
                setShared("");
              }}
            >
              Clear shape
            </button>
            <button disabled={!shape} onClick={shareBoard}>
              Share board
            </button>
            <button className="primary" disabled={!shape} onClick={fresh}>
              Score board
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="card">
            <label>
              Shape name (optional)
              <input
                maxLength={80}
                value={draft.name}
                onChange={(e) => {
                  setShared("");
                  store({
                    ...draft,
                    name: e.target.value,
                    updated: Date.now(),
                  });
                }}
              />
            </label>
            <div className="paper-actions">
              <button onClick={shareBoard}>Share board</button>
              <button onClick={fresh}>Start fresh score</button>
              <button onClick={() => store(draft)}>Save again</button>
              <button
                onClick={() => {
                  history.replaceState(null, "", `${location.pathname}#paper`);
                  setDraft(null);
                  setPoints([]);
                  setName("");
                  setShared("");
                }}
              >
                Create another board
              </button>
            </div>
            <p>
              Sharing includes the shape and its name. Your numbers stay on this
              device.
            </p>
            <h2>Score board</h2>
            <p>
              Enter numbers from 0 to 30. Leave unfilled bubbles blank; zero is
              a number. Press Enter or Tab to move to the next bubble.
            </p>
            <div
              className="paper-scroll"
              tabIndex={0}
              aria-label="Number entry board; scroll to see more bubbles"
            >
              <div className="number-board" style={{ width, height }}>
                <svg aria-hidden="true" width="100%" height="100%">
                  {graph.edges.map(([a, b]) => (
                    <line
                      key={`${a}-${b}`}
                      x1={positions[a][0] - minX + 28}
                      y1={positions[a][1] - minY + 28}
                      x2={positions[b][0] - minX + 28}
                      y2={positions[b][1] - minY + 28}
                    />
                  ))}
                </svg>
                {positions.map(([x, y], i) => (
                  <label
                    className={`paper-number ${highlight.includes(i) ? "highlighted" : ""}`}
                    key={i}
                    style={{ left: x - minX, top: y - minY }}
                  >
                    <span>{i + 1}</span>
                    <input
                      ref={(el) => {
                        fields.current[i] = el;
                      }}
                      aria-label={`Bubble ${i + 1}`}
                      inputMode="numeric"
                      enterKeyHint="next"
                      autoComplete="off"
                      value={draft.values[i] ?? ""}
                      onFocus={(e) => e.target.select()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          fields.current[(i + 1) % 19]?.focus();
                        }
                      }}
                      onChange={(e) => {
                        const text = e.target.value;
                        if (
                          text !== "" &&
                          (!/^\d{1,2}$/.test(text) || Number(text) > 30)
                        ) {
                          setNotice(
                            "Enter a whole number from 0 to 30, or leave blank.",
                          );
                          return;
                        }
                        const values = [...draft.values];
                        values[i] = text === "" ? null : Number(text);
                        store({ ...draft, values, updated: Date.now() });
                      }}
                    />
                  </label>
                ))}
              </div>
            </div>
          </section>
          <section className="card" aria-label="Paper score">
            <h2>
              {draft.values.every((v) => v !== null)
                ? "Final score"
                : "Current score"}
            </h2>
            <p>{draft.values.filter((v) => v !== null).length} of 19 entered</p>
            {!certificate ? (
              <p role="status">Calculating…</p>
            ) : (
              <>
                <strong className="total">{certificate.total}</strong>
                <dl>
                  <dt>Runs</dt>
                  <dd>{certificate.runPoints}</dd>
                  <dt>Sets</dt>
                  <dd>{certificate.setPoints}</dd>
                  <dt>Longest run bonus</dt>
                  <dd>{certificate.runBonus}</dd>
                  <dt>Longest set bonus</dt>
                  <dd>{certificate.setBonus}</dd>
                  <dt>Subtotal</dt>
                  <dd>{certificate.subtotal}</dd>
                  <dt>Orphan penalty</dt>
                  <dd>−{certificate.penalty}</dd>
                </dl>
                <p>Tap a group to highlight its numbered bubbles.</p>
                <div className="paper-actions">
                  {certificate.runs.map((g, i) => (
                    <button key={`r${i}`} onClick={() => setHighlight(g.nodes)}>
                      Run {i + 1}: bubbles{" "}
                      {g.nodes.map((n) => n + 1).join(", ")} · {g.points} points
                    </button>
                  ))}
                  {certificate.sets.map((g, i) => (
                    <button key={`s${i}`} onClick={() => setHighlight(g.nodes)}>
                      Set {i + 1}: bubbles{" "}
                      {g.nodes.map((n) => n + 1).join(", ")} · {g.points} points
                    </button>
                  ))}
                  <button onClick={() => setHighlight(certificate.orphans)}>
                    Orphans: {certificate.orphans.length}
                  </button>
                </div>
                <p>
                  Uses this app’s scoring rules. Scores are provisional until
                  all numbers are entered.
                </p>
              </>
            )}
          </section>
        </>
      )}
      {shared && (
        <label>
          Board link
          <textarea
            aria-label="Board link"
            readOnly
            value={shared}
            onFocus={(e) => e.target.select()}
          />
        </label>
      )}
      {saved.length > 0 && (
        <section className="card">
          <h2>Saved paper boards and scores</h2>
          {saved.map((d) => (
            <button
              className="paper-saved"
              key={d.id}
              onClick={() => {
                setPoints(d.token.startsWith("1.") ? decodeShape(d.token) : []);
                store({ ...d, updated: Date.now() });
                history.replaceState(null, "", shapeLink(d.token, d.name));
                setShared("");
                setNotice("Resumed saved paper score");
              }}
            >
              {d.name || "Paper board"} ·{" "}
              {d.values.filter((v) => v !== null).length}/19 entered
            </button>
          ))}
        </section>
      )}
    </main>
  );
}
