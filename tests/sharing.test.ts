import { it, expect } from "vitest";
import { readResult } from "../src/sharing";
import golden from "./golden.json";
const encode = (x: unknown) =>
  btoa(JSON.stringify(x))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
it("validates all replay fields and rejects corrupted results", async () => {
  const v = golden.vectors[0],
    payload = { schema: 1, code: v.code, moves: v.moves };
  expect((await readResult(encode(payload))).state.moves).toHaveLength(19);
  for (const corrupted of [
    { ...payload, schema: 2 },
    { ...payload, code: "v9-amber-badger-00" },
    { ...payload, moves: [] },
    { ...payload, moves: [{ ...v.moves[0], nodeId: 99 }, ...v.moves.slice(1)] },
    {
      ...payload,
      moves: [{ ...v.moves[0], operation: "divide" }, ...v.moves.slice(1)],
    },
    { ...payload, moves: [v.moves[0], v.moves[0], ...v.moves.slice(2)] },
  ])
    await expect(readResult(encode(corrupted))).rejects.toThrow();
  await expect(readResult("a".repeat(11000))).rejects.toThrow();
  await expect(readResult("%%%")).rejects.toThrow();
});
