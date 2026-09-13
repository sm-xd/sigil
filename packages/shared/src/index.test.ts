import assert from "node:assert/strict";
import { canonicalize, claimIdOf, traceHashOf, usdcToBase, baseToUsdc } from "./index.ts";

assert.equal(canonicalize({ b: 1, a: [{ z: 1, y: undefined }] }), '{"a":[{"z":1}],"b":1}');
assert.equal(usdcToBase("12.5"), 12500000n);
assert.equal(baseToUsdc(12500000n), "12.500000");
const p = { kind: "NO_ENV_READ_OUTSIDE" as const, allowlist: ["PATH"] };
assert.equal(claimIdOf("s", p, "0xABC", "1"), claimIdOf("s", p, "0xabc", "1"));
const base = { v: 1 as const, skillId: "s", predicate: p, runtime: { node: "22", image: "x", shim: 2 }, input: { argv: [], stdin: "" }, events: [] };
assert.equal(traceHashOf(base), traceHashOf({ ...base }));
console.log("shared ok");
