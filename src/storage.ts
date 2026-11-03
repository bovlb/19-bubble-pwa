import { generateChallenge } from "./engine/protocol";
import { replay, type State } from "./engine/rules";
export type Attempt = {
  schema: 1;
  id: string;
  code: string;
  created: number;
  updated: number;
  revision: number;
  state: State;
};
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("bubble19", 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore("attempts", { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function listAttempts(): Promise<Attempt[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("attempts"),
      r = tx.objectStore("attempts").getAll();
    r.onsuccess = () =>
      resolve(r.result.sort((a: Attempt, b: Attempt) => b.updated - a.updated));
    r.onerror = () => reject(r.error);
    tx.oncomplete = () => db.close();
  });
}
export async function validateAttempt(a: Attempt) {
  if (
    !a ||
    a.schema !== 1 ||
    !Number.isFinite(a.created) ||
    !Number.isFinite(a.updated) ||
    typeof a.id !== "string" ||
    !Number.isInteger(a.revision) ||
    typeof a.state?.revealed !== "boolean"
  )
    throw Error("Unsupported or malformed save; original record retained");
  const challenge = await generateChallenge(a.code),
    state = replay(challenge, a.state.moves);
  if (state.moves.length === 19 && a.state.revealed)
    throw Error("Malformed completed save");
  return { challenge, state: { ...state, revealed: a.state.revealed } };
}
export async function saveAttempt(attempt: Attempt): Promise<Attempt> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("attempts", "readwrite"),
      store = tx.objectStore("attempts"),
      read = store.get(attempt.id);
    const next = {
      ...attempt,
      revision: attempt.revision + 1,
      updated: Date.now(),
    };
    let conflict = false;
    read.onsuccess = () => {
      if ((read.result?.revision ?? 0) !== attempt.revision) {
        conflict = true;
        tx.abort();
        return;
      }
      store.put(next);
    };
    tx.oncomplete = () => {
      db.close();
      resolve(next);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(
        Error(
          conflict
            ? "This attempt changed in another tab. Export your progress or reopen the saved attempt."
            : "Progress is not saved. Retry or export your game.",
        ),
      );
    };
  });
}
export function exportAttempt(attempt: Attempt) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(attempt, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `bubble19-${attempt.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
