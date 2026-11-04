import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ChecksumError,
  generateChallenge,
  parseChallenge,
  randomCode,
} from "./engine/protocol";
import {
  applyMove,
  legalNodes,
  operations,
  result,
  roll,
  values,
  type Challenge,
  type Operation,
  type State,
} from "./engine/rules";
import type { Certificate } from "./engine/score";
import {
  exportAttempt,
  listAttempts,
  saveAttempt,
  validateAttempt,
  type Attempt,
} from "./storage";
import { challengeLink, readResult, share } from "./sharing";
import "./style.css";
import { PaperScoring } from "./PaperScoring";
const labels: Record<Operation, string> = {
  add: "＋ Add",
  subtract: "− Difference",
  multiply: "× Multiply",
  min: "min Smaller",
  max: "max Larger",
};
const explanation: Record<Operation, string> = {
  add: "Add both dice",
  subtract: "Subtract the smaller die from the larger",
  multiply: "Multiply both dice",
  min: "Use the smaller die",
  max: "Use the larger die",
};
function App() {
  const [paperRoute, setPaperRoute] = useState<string | null>(() =>
    location.hash.startsWith("#shape/")
      ? location.hash.slice(7)
      : location.hash === "#paper"
        ? ""
        : null,
  );
  const [challenge, setChallenge] = useState<Challenge | null>(null),
    [state, setState] = useState<State>({ moves: [], revealed: false }),
    [attempt, setAttempt] = useState<Attempt | null>(null),
    [attempts, setAttempts] = useState<Attempt[]>([]),
    [damaged, setDamaged] = useState<Attempt[]>([]),
    [readonly, setReadonly] = useState(false),
    [op, setOp] = useState<Operation | null>(null),
    [node, setNode] = useState<number | null>(null),
    [certificate, setCertificate] = useState<Certificate | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [unsaved, setUnsaved] = useState(false),
    [join, setJoin] = useState(""),
    [joinError, setJoinError] = useState<{
      message: string;
      checksum: boolean;
    } | null>(null),
    [wordA, setWordA] = useState(""),
    [wordN, setWordN] = useState(""),
    [digits, setDigits] = useState(""),
    [choices, setChoices] = useState<string[]>([]),
    [shareText, setShareText] = useState(""),
    [update, setUpdate] = useState<ServiceWorker | null>(null),
    [offlineReady, setOfflineReady] = useState(false),
    [highlight, setHighlight] = useState("all");
  const joinErrorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (joinError) joinErrorRef.current?.focus();
  }, [joinError]);
  function clearJoinFeedback() {
    setJoinError(null);
    setChoices([]);
  }
  const lock = useRef(false),
    revision = useRef(0),
    worker = useRef<Worker | null>(null);
  const refresh = () =>
    listAttempts()
      .then(async (records) => {
        const valid: Attempt[] = [],
          invalid: Attempt[] = [];
        for (const record of records) {
          try {
            await validateAttempt(record);
            valid.push(record);
          } catch {
            invalid.push(record);
          }
        }
        setAttempts(valid);
        setDamaged(invalid);
      })
      .catch((e) => setError(String(e)));
  useEffect(() => {
    refresh();
    worker.current = new Worker(
      new URL("./scorer.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.current.onmessage = (e) => {
      if (e.data.revision === revision.current) {
        if (e.data.error) setError(e.data.error);
        else setCertificate(e.data.certificate);
      }
    };
    if ("serviceWorker" in navigator)
      navigator.serviceWorker
        .register(`${import.meta.env.BASE_URL}sw.js`, {
          scope: import.meta.env.BASE_URL,
        })
        .then((reg) => {
          const check = () => {
            setUpdate(reg.active ? reg.waiting : null);
          };
          check();
          reg.addEventListener("updatefound", () =>
            reg.installing?.addEventListener("statechange", check),
          );
          navigator.serviceWorker.ready.then(() => setOfflineReady(true));
        })
        .catch(() =>
          setNotice("Offline cache is not ready. Keep this page open."),
        );
    const route = () => {
      const hash = location.hash;
      if (hash === "#paper" || hash.startsWith("#shape/")) {
        setPaperRoute(hash === "#paper" ? "" : hash.slice(7));
        return;
      }
      setPaperRoute(null);
      if (hash.startsWith("#challenge=")) {
        run(async () => {
          setChallenge(null);
          clearJoinFeedback();
          try {
            const code = decodeURIComponent(hash.slice(11));
            setJoin(code);
            const parsed = await parseChallenge(code);
            if (parsed.codes.length !== 1) {
              setChoices(parsed.codes);
              return;
            }
            const canonical = parsed.codes[0];
            const saved = (await listAttempts()).filter(
              (a) => a.code === canonical,
            );
            for (const candidate of saved) {
              try {
                await validateAttempt(candidate);
              } catch {
                continue;
              }
              await resume(candidate);
              return;
            }
            await start(canonical);
          } catch (error) {
            setJoinError({
              message: (error as Error).message,
              checksum: error instanceof ChecksumError,
            });
          }
        });
      } else if (hash.startsWith("#result=")) {
        readResult(hash.slice(8))
          .then(({ challenge, state }) => {
            setChallenge(challenge);
            setState(state);
            setReadonly(true);
            setAttempt(null);
          })
          .catch((e) => setError(String(e)));
      }
    };
    route();
    window.addEventListener("hashchange", route);
    return () => {
      worker.current?.terminate();
      window.removeEventListener("hashchange", route);
    };
  }, []);
  useEffect(() => {
    setCertificate(null);
    if (challenge)
      worker.current?.postMessage({
        revision: ++revision.current,
        graph: challenge,
        values: values(challenge, state),
      });
  }, [challenge, state]);
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function persist(a: Attempt) {
    setAttempt(a);
    try {
      const saved = await saveAttempt(a);
      setAttempt(saved);
      setUnsaved(false);
      await refresh();
    } catch (e) {
      setUnsaved(true);
      setError((e as Error).message);
    }
  }
  async function start(code: string) {
    const c = await generateChallenge(code),
      s = { moves: [], revealed: false };
    setChallenge(c);
    setState(s);
    setReadonly(false);
    setOp(null);
    setNode(null);
    setShareText("");
    const now = Date.now();
    await persist({
      schema: 1,
      id: crypto.randomUUID(),
      code,
      created: now,
      updated: now,
      revision: 0,
      state: s,
    });
  }
  async function resume(a: Attempt) {
    const validated = await validateAttempt(a);
    setChallenge(validated.challenge);
    setState(validated.state);
    setAttempt(a);
    setReadonly(false);
    setUnsaved(false);
    setOp(null);
    setNode(null);
    setShareText("");
  }
  async function commit(next: State) {
    setState(next);
    setOp(null);
    setNode(null);
    if (attempt) await persist({ ...attempt, state: next });
  }
  const complete = state.moves.length === 19,
    v = challenge ? values(challenge, state) : [],
    legal = challenge ? legalNodes(challenge, state) : [],
    pair =
      challenge && state.revealed ? challenge.dice[state.moves.length] : null;
  const counts = Object.fromEntries(
    operations.map((o) => [
      o,
      state.moves.filter((m) => m.operation === o).length,
    ]),
  ) as Record<Operation, number>;
  async function doShare(text: string) {
    setShareText(text);
    setNotice(await share(text));
  }
  function scoreText() {
    if (!certificate || !challenge) return "";
    return `19 Bubbles · ${challenge.code}\nScore ${certificate.total}\nRuns ${certificate.runPoints}; sets ${certificate.setPoints}; run bonus ${certificate.runBonus}; set bonus ${certificate.setBonus}; subtotal ${certificate.subtotal}; orphan penalty ${certificate.penalty}\n${challengeLink(challenge.code)}`;
  }
  const points = challenge?.coordinates.map(([q, r]) => [
      q * 64 + r * 32,
      r * 55.43,
    ]),
    xs = points?.map((p) => p[0]) ?? [0],
    ys = points?.map((p) => p[1]) ?? [0];
  if (paperRoute !== null)
    return (
      <PaperScoring
        key={paperRoute}
        token={paperRoute}
        onHome={() => {
          history.replaceState(null, "", location.pathname + location.search);
          setPaperRoute(null);
        }}
      />
    );
  return (
    <main>
      <header>
        <button
          className="wordmark"
          onClick={() => {
            setChallenge(null);
            setShareText("");
            refresh();
          }}
        >
          19<span>BUBBLES</span>
        </button>
        <p>A little arithmetic. A connected world.</p>
        <span className="badge">
          {offlineReady ? "Ready for offline play" : "Preparing offline play"}
        </span>
      </header>
      {error && (
        <div role="alert" className="alert">
          {error}
        </div>
      )}
      <p className="announcement" role="status" aria-live="polite">
        {notice}
      </p>
      {unsaved && attempt && (
        <section className="alert">
          <strong>Progress is not saved</strong>
          <button onClick={() => run(() => persist(attempt))}>
            Retry save
          </button>
          <button onClick={() => exportAttempt(attempt)}>Export game</button>
        </section>
      )}
      {damaged.length > 0 && (
        <section className="alert">
          <p>
            {damaged.length} unreadable saved record(s) retained. Export them
            for recovery; other games remain available.
          </p>
          {damaged.map((a, i) => (
            <button key={i} onClick={() => exportAttempt(a)}>
              Export unreadable record {i + 1}
            </button>
          ))}
        </section>
      )}
      {!challenge ? (
        <>
          <section className="hero">
            <span className="eyebrow">ROLL · CONNECT · DISCOVER</span>
            <h1>
              Nineteen bubbles.
              <br />
              Countless possibilities.
            </h1>
            <p>
              Roll two dice, choose an operation, and grow a connected board.
              Find runs and matching sets along the way.
            </p>
            <button
              className="primary"
              disabled={busy}
              onClick={() => run(async () => start(await randomCode()))}
            >
              Start new game
            </button>
            <button
              onClick={() => {
                location.hash = "paper";
              }}
            >
              Score a paper game
            </button>
          </section>
          <div className="home-grid">
            <section className="card">
              <h2>Play the same puzzle</h2>
              <p>A shared code gives everyone the same board and rolls.</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    clearJoinFeedback();
                    setNotice("");
                    try {
                      const p = await parseChallenge(
                        join || `${wordA}-${wordN}-${digits}`,
                      );
                      setChoices(p.codes);
                      if (p.corrected)
                        setNotice("Corrected code: " + p.codes.join(", "));
                      if (
                        p.codes.length === 1 &&
                        !attempts.some((a) => a.code === p.codes[0])
                      )
                        await start(p.codes[0]);
                    } catch (error) {
                      setJoinError({
                        message: (error as Error).message,
                        checksum: error instanceof ChecksumError,
                      });
                    }
                  });
                }}
              >
                <div className="join-fields">
                  <label>
                    Adjective
                    <input
                      value={wordA}
                      onChange={(e) => {
                        clearJoinFeedback();
                        setWordA(e.target.value);
                        setJoin("");
                      }}
                      autoCapitalize="none"
                    />
                  </label>
                  <label>
                    Noun
                    <input
                      value={wordN}
                      onChange={(e) => {
                        clearJoinFeedback();
                        setWordN(e.target.value);
                        setJoin("");
                      }}
                      autoCapitalize="none"
                    />
                  </label>
                  <label>
                    Check digits
                    <input
                      aria-invalid={!!joinError?.checksum && !join}
                      aria-describedby={
                        joinError && !join ? "join-error" : undefined
                      }
                      value={digits}
                      inputMode="numeric"
                      maxLength={2}
                      onChange={(e) => {
                        clearJoinFeedback();
                        setDigits(e.target.value);
                        setJoin("");
                      }}
                    />
                  </label>
                </div>
                <label htmlFor="join">Or paste a full code or link</label>
                <input
                  id="join"
                  aria-invalid={!!joinError && !!join}
                  aria-describedby={
                    joinError && join ? "join-error" : undefined
                  }
                  value={join}
                  placeholder="v1-adjective-noun-00"
                  onChange={(e) => {
                    clearJoinFeedback();
                    setJoin(e.target.value);
                  }}
                />
                {joinError && (
                  <div
                    id="join-error"
                    ref={joinErrorRef}
                    role="alert"
                    tabIndex={-1}
                    className="join-error"
                  >
                    <strong>
                      {joinError.checksum
                        ? "Check digits don’t match"
                        : "Couldn’t join this challenge"}
                    </strong>
                    <p>
                      {joinError.checksum
                        ? "The words are recognized, but the two check digits don’t match. Compare all three parts with the original code, then try again."
                        : joinError.message}
                    </p>
                  </div>
                )}
                <button disabled={busy}>Join existing game</button>
              </form>
              {choices.map((code) => (
                <div key={code}>
                  <strong>{code}</strong>
                  {attempts
                    .filter((a) => a.code === code)
                    .map((a) => (
                      <button key={a.id} onClick={() => run(() => resume(a))}>
                        Continue {a.state.moves.length}/19
                      </button>
                    ))}
                  <button onClick={() => run(() => start(code))}>
                    Start separate attempt
                  </button>
                </div>
              ))}
            </section>
            <section className="card">
              <h2>Your games</h2>
              {attempts.length === 0 ? (
                <p>Your games stay on this device. No account needed.</p>
              ) : (
                attempts.map((a, i) => (
                  <button
                    className="attempt"
                    key={a.id}
                    onClick={() => run(() => resume(a))}
                  >
                    <span>
                      {i ===
                      attempts.findIndex((item) => item.state.moves.length < 19)
                        ? "Continue Game · "
                        : ""}
                      {a.code}
                    </span>
                    <small>{a.state.moves.length} of 19 placed</small>
                  </button>
                ))
              )}
              <label className="import">
                Recover an exported game
                <input
                  type="file"
                  accept="application/json"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file)
                      run(async () => {
                        if (file.size > 65536)
                          throw Error("Save file too large");
                        const a = JSON.parse(await file.text());
                        await validateAttempt(a);
                        const copy = {
                          ...a,
                          id: crypto.randomUUID(),
                          revision: 0,
                        };
                        await resume(copy);
                        await persist(copy);
                      });
                  }}
                />
              </label>
            </section>
          </div>
        </>
      ) : (
        <>
          <p role="status" className="save-status">
            {readonly
              ? "Read-only result"
              : busy
                ? "Saving…"
                : unsaved
                  ? "Not saved"
                  : "Saved on this device"}
          </p>
          <div className="game-heading">
            <div>
              <span className="eyebrow">
                {readonly
                  ? "READ-ONLY REPLAY"
                  : complete
                    ? "COMPLETE"
                    : "YOUR CHALLENGE"}
              </span>
              <h1 className="code">{challenge.code}</h1>
              <p>
                {state.moves.length} of 19 placed
                {!complete ? ` · Turn ${state.moves.length + 1}` : ""}
              </p>
            </div>
            <button
              onClick={() => run(() => doShare(challengeLink(challenge.code)))}
            >
              Copy / share challenge
            </button>
          </div>
          <div className="game-grid">
            <section className="card board-card">
              <svg
                className="board"
                role="group"
                aria-label="Game board"
                viewBox={`${Math.min(...xs) - 36} ${Math.min(...ys) - 36} ${Math.max(...xs) - Math.min(...xs) + 72} ${Math.max(...ys) - Math.min(...ys) + 72}`}
              >
                {challenge.edges.map(([a, b]) => (
                  <line
                    key={`${a}-${b}`}
                    x1={points![a][0]}
                    y1={points![a][1]}
                    x2={points![b][0]}
                    y2={points![b][1]}
                  />
                ))}
                {points!.map(([x, y], i) => {
                  const runIndex =
                      certificate?.runs.findIndex((r) => r.nodes.includes(i)) ??
                      -1,
                    setIndex =
                      certificate?.sets.findIndex((r) => r.nodes.includes(i)) ??
                      -1,
                    orphan = certificate?.orphans.includes(i);
                  const enabled = !readonly && !!pair && legal.includes(i);
                  return (
                    <g
                      key={i}
                      role="button"
                      tabIndex={enabled ? 0 : -1}
                      aria-disabled={!enabled}
                      aria-pressed={node === i}
                      aria-label={`Bubble ${i + 1}, ${v[i] === null ? (legal.includes(i) ? "empty, legal" : "empty, unavailable") : v[i]}${runIndex >= 0 ? ", run " + (runIndex + 1) : ""}${setIndex >= 0 ? ", set " + (setIndex + 1) : ""}`}
                      onClick={() => enabled && setNode(i)}
                      onKeyDown={(e) => {
                        if (enabled && (e.key === "Enter" || e.key === " ")) {
                          e.preventDefault();
                          setNode(i);
                        }
                      }}
                      className={`bubble ${v[i] !== null ? "filled" : ""} ${enabled ? "legal" : ""} ${node === i ? "selected" : ""}`}
                    >
                      <circle cx={x} cy={y} r="24" />
                      {runIndex >= 0 && highlight !== "sets" && (
                        <circle className="run-ring" cx={x} cy={y} r="21" />
                      )}
                      {setIndex >= 0 && highlight !== "runs" && (
                        <rect
                          className="set-ring"
                          x={x - 18}
                          y={y - 18}
                          width="36"
                          height="36"
                          rx="9"
                        />
                      )}
                      <text x={x} y={y + 5}>
                        {v[i] ??
                          (node === i && op ? result(op, ...pair!) : "·")}
                      </text>
                      <text className="group-label" x={x} y={y + 17}>
                        {[
                          runIndex >= 0 ? `R${runIndex + 1}` : "",
                          setIndex >= 0 ? `S${setIndex + 1}` : "",
                          orphan ? "!" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      </text>
                    </g>
                  );
                })}
              </svg>
              <p className="hint">
                {complete
                  ? "Your completed board"
                  : state.revealed
                    ? "Choose an outlined bubble and an operation."
                    : "Roll to reveal your next pair."}
              </p>
              <label>
                Group highlights{" "}
                <select
                  value={highlight}
                  onChange={(e) => setHighlight(e.target.value)}
                >
                  <option value="all">Runs and sets</option>
                  <option value="runs">Runs</option>
                  <option value="sets">Sets</option>
                </select>
              </label>
              <details>
                <summary>Large bubble controls</summary>
                <div className="bubble-controls">
                  {v.map((value, i) => (
                    <button
                      key={i}
                      disabled={readonly || !pair || !legal.includes(i)}
                      aria-pressed={node === i}
                      onClick={() => setNode(i)}
                    >
                      Bubble {i + 1}
                      <small>
                        {value === null ? "Empty" : `Value ${value}`}
                      </small>
                    </button>
                  ))}
                </div>
              </details>
              <p className="hint">
                R = run · S = set · ! = orphan. Groups may change after each
                move.
              </p>
            </section>
            <aside>
              <section className="card turn-card">
                {!complete && !readonly ? (
                  <>
                    <h2>{pair ? "Choose your move" : "Ready to roll?"}</h2>
                    <div
                      className="dice"
                      aria-label={
                        pair
                          ? `Dice ${pair[0]} and ${pair[1]}`
                          : "Dice not yet revealed"
                      }
                    >
                      <span>{pair?.[0] ?? "?"}</span>
                      <span>{pair?.[1] ?? "?"}</span>
                    </div>
                    {!pair && (
                      <p className="hint">
                        Remaining uses:{" "}
                        {operations
                          .map((o) => `${labels[o]} ${4 - counts[o]}`)
                          .join(" · ")}
                      </p>
                    )}
                    {!pair ? (
                      <button
                        className="primary full"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await commit(roll(state));
                            setNotice(
                              `Rolled ${challenge.dice[state.moves.length].join(" and ")}`,
                            );
                          })
                        }
                      >
                        Roll dice
                      </button>
                    ) : (
                      <>
                        <div className="operations">
                          {operations.map((o) => (
                            <button
                              key={o}
                              aria-pressed={op === o}
                              title={explanation[o]}
                              disabled={counts[o] >= 4 || busy}
                              onClick={() => setOp(o)}
                            >
                              <span>{labels[o]}</span>
                              <b>{result(o, ...pair)}</b>
                              <small>{4 - counts[o]} uses left</small>
                            </button>
                          ))}
                        </div>
                        <p>
                          {op
                            ? `${explanation[op]}: ${result(op, ...pair)}`
                            : "Choose an operation. Equal results use separate counters."}
                        </p>
                        <button
                          className="primary full"
                          disabled={busy || !op || node === null}
                          onClick={() =>
                            run(async () => {
                              const next = applyMove(challenge, state, {
                                nodeId: node!,
                                operation: op!,
                              });
                              await commit(next);
                              setNotice(`Move ${next.moves.length} submitted`);
                            })
                          }
                        >
                          Submit Move
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <h2>
                      {readonly ? "Shared result" : "Beautifully connected."}
                    </h2>
                    <p>All 19 bubbles placed.</p>
                    <button
                      className="primary full"
                      disabled={!certificate}
                      onClick={() => run(() => doShare(scoreText()))}
                    >
                      Share Result
                    </button>
                    {readonly && (
                      <button onClick={() => run(() => start(challenge.code))}>
                        Play this challenge
                      </button>
                    )}
                    <button
                      onClick={() => run(async () => start(await randomCode()))}
                    >
                      New Game
                    </button>
                  </>
                )}
              </section>
              <section className="card score-card" aria-live="polite">
                <h2>
                  {complete ? "Final score" : "Current score · provisional"}
                </h2>
                {certificate ? (
                  <>
                    <div className="total">{certificate.total}</div>
                    <dl>
                      {[
                        ["Runs", certificate.runPoints],
                        ["Sets", certificate.setPoints],
                        ["Longest run bonus", certificate.runBonus],
                        ["Longest set bonus", certificate.setBonus],
                        ["Subtotal", certificate.subtotal],
                        ["Orphan penalty", certificate.penalty],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <dt>{label}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                    <details>
                      <summary>Scoring explanation</summary>
                      {certificate.runs.map((r, i) => (
                        <p key={"r" + i}>
                          R{i + 1}: bubbles{" "}
                          {r.nodes.map((n) => n + 1).join(" → ")} · {r.points}{" "}
                          points
                        </p>
                      ))}
                      {certificate.sets.map((r, i) => (
                        <p key={"s" + i}>
                          S{i + 1}: bubbles{" "}
                          {r.nodes.map((n) => n + 1).join(", ")} · {r.points}{" "}
                          points
                        </p>
                      ))}
                      <p>
                        Orphans:{" "}
                        {certificate.orphans.map((n) => n + 1).join(", ") ||
                          "none"}
                      </p>
                      <p>
                        Longest run: {certificate.longestRun}; longest set:{" "}
                        {certificate.longestSet}.
                      </p>
                    </details>
                  </>
                ) : (
                  <p>Calculating exact score…</p>
                )}
              </section>
            </aside>
          </div>
        </>
      )}
      {shareText && (
        <section className="card">
          <label htmlFor="share">Copyable share text</label>
          <textarea
            id="share"
            readOnly
            value={shareText}
            onFocus={(e) => e.target.select()}
          />
        </section>
      )}
      <details className="rules">
        <summary>How to play</summary>
        <p>
          Roll, choose one of five operations, then place its result. Each
          operation has four uses. After your first move, each new bubble must
          touch a filled bubble. Submit commits your choice; there is no undo.
        </p>
        <p>
          Runs follow edges and increase by exactly one. Sets are whole
          connected groups of equal values. Each group scores its highest value
          plus its size minus one. Runs cannot share bubbles with other runs,
          but can overlap sets. The longest run and set each earn one bonus.
          Uncovered bubbles cost 3 points each. The scorer finds the highest
          possible total; scores can decrease.
        </p>
        <p>
          Length bonuses (2–9): 0, 1, 3, 6, 10, 15, 20, 25. Each bubble beyond 9
          adds 5 bonus points.
        </p>
      </details>
      {update && (
        <section className="card">
          <p>An update is ready. Save your progress before reloading.</p>
          <button
            disabled={unsaved || busy || (state.revealed && !complete)}
            onClick={() => {
              navigator.serviceWorker.addEventListener(
                "controllerchange",
                () => location.reload(),
                { once: true },
              );
              update.postMessage("ACTIVATE");
            }}
          >
            Apply update at this safe point
          </button>
        </section>
      )}
      <footer>
        Made for a quiet moment. Progress lives in this browser; clearing
        browser storage removes it. No accounts, analytics, or cloud backup.
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
