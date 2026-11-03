import { generateChallenge } from "./engine/protocol";
import { replay, type Move } from "./engine/rules";
export const challengeLink = (code: string) =>
  `${location.origin}${import.meta.env.BASE_URL}#challenge=${encodeURIComponent(code)}`;
export function resultLink(code: string, moves: Move[]) {
  return `${location.origin}${import.meta.env.BASE_URL}#result=${btoa(
    JSON.stringify({ schema: 1, code, moves }),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")}`;
}
export async function readResult(encoded: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length > 10923)
    throw Error("Invalid or oversized result");
  const raw = atob(encoded.replaceAll("-", "+").replaceAll("_", "/"));
  if (raw.length > 8192) throw Error("Result exceeds 8 KiB");
  const payload = JSON.parse(raw);
  if (
    payload.schema !== 1 ||
    !Array.isArray(payload.moves) ||
    payload.moves.length !== 19
  )
    throw Error("Expected a completed schema 1 result");
  const challenge = await generateChallenge(payload.code),
    state = replay(challenge, payload.moves);
  return { challenge, state };
}
export async function share(text: string) {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return "Shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "Sharing cancelled";
    }
  }
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return "Copied";
    } catch {}
  }
  return "Select and copy the text below";
}
