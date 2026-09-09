// tsx src/index.test.ts — node:assert, no framework. Three checks: decide() table, local-wallet calldata, the loop against a fake gateway.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { decodeFunctionData, toFunctionSelector } from "viem";
import { decide, type SkillSummary } from "./discover.ts";
import { runOnce, type Deps } from "./index.ts";
import { SIGIL_STAKE_ABI, disputeCalldata, localWallet } from "./wallet.ts";

const base: SkillSummary = {
  id: "a".repeat(64), name: "good-skill", sourceUri: "hcs://1/0.0.1", author: "0xauthor", registeredAt: 0,
  manifest: { entrypoint: "index.js", declaredEnv: [], declaredHosts: [] },
  totalStaked: "250000000", liveClaims: 1, disputes: 0, sustainedDisputes: 0, oldestClaimAgeSec: 3600,
};
const policy = { minStakeUsdc: 50, minClaimAgeSec: 60, maxSustainedDisputes: 0 };

// ── decide() ──────────────────────────────────────────────────────────────────
{
  const t = (patch: Partial<SkillSummary>, install: boolean, needle: string) => {
    const r = decide({ ...base, ...patch }, policy);
    assert.equal(r.install, install, JSON.stringify(patch));
    assert.ok(r.reasons.length > 0 && r.reasons.some((x) => x.includes(needle)), r.reasons.join(" | "));
  };
  t({ liveClaims: 0, totalStaked: "0", oldestClaimAgeSec: null }, false, "unstaked → skip");
  t({ totalStaked: "10000000" }, false, "totalStaked 10.000000 < 50 ✗ → skip");
  t({ oldestClaimAgeSec: 12 }, false, "oldestClaimAge 12s < 60s ✗ → skip");
  t({ sustainedDisputes: 1 }, false, "sustainedDisputes 1 > 0 ✗ → skip");
  t({}, true, "totalStaked 250.000000 ≥ 50 ✓");
  assert.deepEqual(decide(base, policy).reasons, ["totalStaked 250.000000 ≥ 50 ✓", "oldestClaimAge 3600s ≥ 60s ✓", "sustainedDisputes 0 ≤ 0 ✓"]);
  console.log("ok decide(): unstaked / low stake / young claim / sustained dispute skip; healthy installs; reasons readable");
}

// ── wallet.ts local backend: dispute calldata, nothing sent ──────────────────
{
  const claimId = `0x${"11".repeat(32)}`;
  const traceHash = "ab".repeat(32); // sha256 hex without 0x, as TraceBundle carries it
  const data = disputeCalldata(claimId, 25_000_000n, traceHash);
  assert.ok(data.startsWith(toFunctionSelector("dispute(bytes32,uint256,bytes32)")));
  const { functionName, args } = decodeFunctionData({ abi: SIGIL_STAKE_ABI, data });
  assert.equal(functionName, "dispute");
  assert.deepEqual(args, [claimId, 25_000_000n, `0x${traceHash}`]);
  console.log("ok disputeCalldata(): selector + args round-trip");
}

// ── the loop against a fake gateway ──────────────────────────────────────────
{
  const claim = {
    id: `0x${"22".repeat(32)}`, skillId: base.id, predicate: { kind: "NO_ENV_READ_OUTSIDE" as const, allowlist: ["HOME"] },
    stakeAmount: "100000000", stakedBy: "0xstaker", humanProofRef: "0xh", status: "LIVE" as const, arcEscrowId: "", hcsTopicId: "0.0.5", createdAt: 0,
  };
  const unstaked: SkillSummary = { ...base, id: "b".repeat(64), name: "unstaked-skill", totalStaked: "0", liveClaims: 0, oldestClaimAgeSec: null };
  const calls: { path: string; body: unknown }[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const url = req.url!;
      const json = (o: unknown, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
      if (req.method === "POST") calls.push({ path: url, body: JSON.parse(raw) });
      if (url === "/skills") return json({ skills: [unstaked, base] });
      if (url === `/skills/${base.id}`) return json({ skill: base, claims: [claim], disputes: [], resolutions: [], license: { tokenId: "0.0.9" } });
      if (url === `/skills/${base.id}/source`) return json({ skillId: base.id, source: { entrypoint: "index.js", files: { "index.js": "process.env.SIGIL_CANARY_AWS" } }, manifest: base.manifest });
      if (url.endsWith("/dispute")) return json({ id: "d1", claimId: claim.id, by: "", counterBond: "", evidenceUri: "hcs://1/0.0.7", traceHash: "cd".repeat(32), status: "OPEN" });
      if (url.endsWith("/resolve")) return json({ reproduced: true, observedHash: "cd".repeat(32), verdictTxHash: "0x0" });
      if (url.endsWith("/resolved")) return json({ claimId: claim.id, disputeId: "d1", outcome: "CLAIM_BROKEN", winner: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", reason: "CLAIM_BROKEN", arcTxHash: "", hcsSequence: 1 });
      json({ error: `not found ${url}` }, 404);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const gateway = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const violation = { seq: 1, kind: "env" as const, target: "SIGIL_CANARY_AWS", stack: ["index.js:1"] };
  const bundle = { v: 1 as const, skillId: base.id, predicate: claim.predicate, runtime: { node: "22", image: "sigil-sandbox:node22" }, input: { argv: [], stdin: "" }, events: [violation], violations: [violation], traceHash: "cd".repeat(32) };
  // well-known Hardhat test key #1 → 0x7099…79C8; nothing is ever sent (SIGIL_STAKE_ADDRESS empty)
  const wallet = localWallet({ AGENT_ARC_KEY: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", ARC_RPC_URL: "http://127.0.0.1:1" });
  const lines: string[] = [];
  const deps: Deps = {
    gateway, policy, payer: { accountId: "0.0.1234", fetch }, wallet, stakeAddress: "", explorer: "arcscan", mirror: "unused",
    worldProof: { mock: true, nullifier: "0xn" }, run: async () => bundle, log: (s) => lines.push(s), installed: new Set(),
  };
  const tally = await runOnce(deps);
  server.close();

  assert.deepEqual(tally, { paid: 0, disputed: 1, resolved: 1 });
  assert.deepEqual(calls.map((c) => c.path), [`/claims/${claim.id}/dispute`, `/claims/${claim.id}/resolve`, `/claims/${claim.id}/resolved`]);
  assert.deepEqual(calls[0].body, { by: await wallet.address(), counterBond: "25000000", traceBundle: bundle, arcTxHash: "", worldProof: { mock: true, nullifier: "0xn" } });
  assert.deepEqual(calls[2].body, { arcTxHash: "" });
  assert.ok(lines.some((l) => l.includes("unstaked → skip")), "prints the skip reason");
  assert.ok(lines.some((l) => l.includes("SIGIL_STAKE_ADDRESS empty")), "warns loudly when on-chain is skipped");
  assert.ok(lines.some((l) => l.includes("CLAIM_BROKEN · winner 0x7099") && l.includes("(this agent)")));
  console.log("ok loop: skip unstaked → install staked → violation → dispute → resolve → resolved, in order, right bodies");
  console.log(lines.map((l) => `    ${l}`).join("\n"));
}
