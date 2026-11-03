export const operations = [
  "add",
  "subtract",
  "multiply",
  "min",
  "max",
] as const;
export type Operation = (typeof operations)[number];
export type Graph = {
  coordinates: [number, number][];
  edges: [number, number][];
};
export type Challenge = Graph & { code: string; dice: [number, number][] };
export type Move = { nodeId: number; operation: Operation };
export type State = { moves: Move[]; revealed: boolean };
export function result(op: Operation, a: number, b: number): number {
  switch (op) {
    case "add":
      return a + b;
    case "subtract":
      return Math.abs(a - b);
    case "multiply":
      return a * b;
    case "min":
      return Math.min(a, b);
    case "max":
      return Math.max(a, b);
    default:
      throw Error("Unknown operation");
  }
}
export function values(challenge: Challenge, state: State): (number | null)[] {
  const v = Array<number | null>(19).fill(null);
  state.moves.forEach((m, i) => {
    v[m.nodeId] = result(m.operation, ...challenge.dice[i]);
  });
  return v;
}
export function legalNodes(challenge: Graph, state: State): number[] {
  const used = new Set(state.moves.map((m) => m.nodeId));
  return challenge.coordinates
    .map((_, i) => i)
    .filter(
      (i) =>
        !used.has(i) &&
        (!used.size ||
          challenge.edges.some(
            ([a, b]) => (a === i && used.has(b)) || (b === i && used.has(a)),
          )),
    );
}
export function roll(state: State): State {
  if (state.revealed || state.moves.length >= 19)
    throw Error("Cannot roll now");
  return { ...state, revealed: true };
}
export function applyMove(
  challenge: Challenge,
  state: State,
  move: Move,
): State {
  if (!state.revealed || state.moves.length >= 19)
    throw Error("Roll before submitting");
  if (
    !operations.includes(move.operation) ||
    state.moves.filter((m) => m.operation === move.operation).length >= 4
  )
    throw Error("Operation unavailable");
  if (
    !Number.isInteger(move.nodeId) ||
    !legalNodes(challenge, state).includes(move.nodeId)
  )
    throw Error("Choose a legal empty bubble");
  return {
    moves: [...state.moves, { nodeId: move.nodeId, operation: move.operation }],
    revealed: false,
  };
}
export function replay(challenge: Challenge, moves: Move[]): State {
  if (!Array.isArray(moves) || moves.length > 19)
    throw Error("Invalid history");
  return moves.reduce((s, m) => applyMove(challenge, roll(s), m), {
    moves: [],
    revealed: false,
  } as State);
}
