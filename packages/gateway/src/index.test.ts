// Gate for build-spec §13 step 3: one REAL paid request through Blocky402 on Hedera testnet, plus the
// contract routes and the World both-sides rule. Needs HEDERA_OPERATOR_ID/KEY in the repo-root .env.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalize, skillIdOf, traceHashOf, usdcToBase, type TraceBundle } from "@sigil/shared";
import { SHIM_VERSION } from "@sigil/sandbox";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import type { Network, PaymentRequirements } from "@x402/core/types";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { createClientHederaSigner, PrivateKey as HieroPrivateKey } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { AccountCreateTransaction, AccountDeleteTransaction, Client, Hbar, PrivateKey } from "@hashgraph/sdk";

process.env.GATEWAY_STATE_FILE = join(tmpdir(), `sigil-gateway-test-${Date.now()}.json`);
process.env.WORLD_MODE = "mock";
const { startServer } = await import("./server.ts"); // dynamic: env overrides above must precede its module init

const NETWORK = (process.env.X402_NETWORK ?? "hedera:testnet") as Network;
const MIRROR = process.env.HEDERA_MIRROR_URL ?? "https://testnet.mirrornode.hedera.com";
const OP_ID = process.env.HEDERA_OPERATOR_ID ?? "";
const OP_KEY = process.env.HEDERA_OPERATOR_KEY ?? "";
assert(OP_ID && OP_KEY, "HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY are required");

const server = await startServer(0);
const base = `http://localhost:${(server.address() as AddressInfo).port}`;
const json = async (path: string, init?: RequestInit) => {
  const r = await fetch(base + path, init);
  return { status: r.status, headers: r.headers, body: await r.json() as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const post = (path: string, body: unknown) => json(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// ── 1. health, register, list ────────────────────────────────────────────────
assert.equal((await json("/health")).body.ok, true);
const source = { entrypoint: "index.js", files: { "index.js": "console.log('hello from the sigil gateway test skill');\n" } };
const manifest = { entrypoint: "index.js", declaredEnv: [], declaredHosts: [] };
const reg = await post("/skills", { name: "test-skill", author: "sigil-test", manifest, source });
assert.equal(reg.status, 201, JSON.stringify(reg.body));
const skillId = skillIdOf(source);
assert.equal(reg.body.id, skillId);
assert.equal((await json("/skills")).body.skills.find((s: { id: string }) => s.id === skillId)?.totalStaked, "0");
assert.equal((await json("/skills/does-not-exist/source")).status, 404);
console.log("✓ 1 health / POST /skills / GET /skills");

// ── 2. 402 with Blocky402 requirements, metered per KB ───────────────────────
const bytes = Buffer.byteLength(canonicalize(source));
const kb = Math.max(1, Math.ceil(bytes / 1024));
const expectUsdc = (usdcToBase(process.env.PRICE_PER_KB_USDC ?? "0.001") * BigInt(kb)).toString();
const unpaid = await json(`/skills/${skillId}/source`);
assert.equal(unpaid.status, 402, JSON.stringify(unpaid.body));
const required = decodePaymentRequiredHeader(unpaid.headers.get("PAYMENT-REQUIRED") ?? "");
const usdcLeg = required.accepts.find((a) => a.network === NETWORK && a.asset !== "0.0.0") as PaymentRequirements;
const hbarLeg = required.accepts.find((a) => a.network === NETWORK && a.asset === "0.0.0") as PaymentRequirements;
assert(usdcLeg && hbarLeg, `402 must offer USDC and HBAR legs on ${NETWORK}: ${JSON.stringify(required.accepts)}`);
assert.equal(usdcLeg.amount, expectUsdc);
assert.equal(hbarLeg.amount, (BigInt(expectUsdc) * 100n).toString());
assert.equal(usdcLeg.payTo, OP_ID);
assert.equal(unpaid.body.accepts.length, 2);
console.log(`✓ 2 402: ${bytes} bytes = ${kb} KB -> ${expectUsdc} USDC-units (${usdcLeg.asset}) or ${hbarLeg.amount} tinybar; feePayer ${String(hbarLeg.extra?.feePayer)}`);

// ── 3. THE REAL PAID REQUEST (temporary ECDSA payer funded by the operator) ───
const client = Client.forTestnet().setOperator(OP_ID, PrivateKey.fromStringECDSA(OP_KEY));
const payerKey = PrivateKey.generateECDSA();
const created = await (await new AccountCreateTransaction().setKeyWithoutAlias(payerKey.publicKey).setInitialBalance(new Hbar(5)).execute(client)).getReceipt(client);
const payerId = created.accountId!.toString();
console.log(`  payer ${payerId} funded with 5 HBAR: https://hashscan.io/testnet/account/${payerId}`);
try {
  await waitFor(`mirror node to index ${payerId}`, async () => (await fetch(`${MIRROR}/api/v1/accounts/${payerId}`)).ok);
  const signer = createClientHederaSigner(payerId, HieroPrivateKey.fromStringECDSA(payerKey.toStringRaw()), { network: NETWORK });
  const x402 = new x402Client()
    .register(NETWORK, new ExactHederaScheme(signer))
    .setSpendControls({ allowedAssets: [{ network: NETWORK, asset: "0.0.0" }] }) // HBAR is not a client "default asset"
    .registerPolicy((_v, reqs) => reqs.filter((r) => r.asset === "0.0.0")); // payer holds no testnet USDC: pay the HBAR leg
  const paid = await wrapFetchWithPayment(fetch, x402)(`${base}/skills/${skillId}/source`);
  const text = await paid.text();
  assert.equal(paid.status, 200, `paid request failed: HTTP ${paid.status} ${text}`);
  const body = JSON.parse(text);
  assert.equal(body.skillId, skillId);
  assert.deepEqual(body.source, source);
  const settle = decodePaymentResponseHeader(paid.headers.get("PAYMENT-RESPONSE") ?? "");
  assert.equal(settle.success, true, JSON.stringify(settle));
  assert(settle.transaction, "PAYMENT-RESPONSE must carry the Hedera transaction id");
  console.log(`✓ 3 PAID: ${hbarLeg.amount} tinybar from ${settle.payer || payerId} -> ${OP_ID}, settled by Blocky402 on ${settle.network}`);
  console.log(`  HashScan: https://hashscan.io/testnet/transaction/${settle.transaction}`);
  const tx = await mirrorTransaction(settle.transaction);
  if (tx) console.log(`  mirror node: result=${tx.result} charged_tx_fee=${tx.charged_tx_fee} tinybar (paid by the facilitator) id=${tx.transaction_id}`);
} finally {
  try {
    const del = await new AccountDeleteTransaction().setAccountId(payerId).setTransferAccountId(OP_ID).freezeWith(client).sign(payerKey);
    await (await del.execute(client)).getReceipt(client);
    console.log(`  payer ${payerId} deleted, leftover HBAR returned to ${OP_ID}`);
  } catch (e) { console.warn(`  payer cleanup failed (leaves ~5 HBAR in ${payerId}): ${(e as Error).message}`); }
  client.close();
}

// ── 4. World both-sides rule + evidence bound to the claim ───────────────────
const predicate = { kind: "NO_ENV_READ_OUTSIDE" as const, allowlist: [] as string[] };
const N = `0x${"11".repeat(32)}`, M = `0x${"22".repeat(32)}`;
const staker = `0x${"aa".repeat(20)}`, disputer = `0x${"bb".repeat(20)}`;
const claim = await post("/claims", { skillId, predicate, stakeAmount: "10000000", stakedBy: staker, arcTxHash: "", nonce: "test", worldProof: { mock: true, nullifier: N } });
assert.equal(claim.status, 201, JSON.stringify(claim.body));

// probe: the gateway runs the claim's skill in its sandbox and returns a self-consistent bundle for this claim (an honest skill: no violations).
const probed = await post(`/claims/${claim.body.id}/probe`, {});
assert.equal(probed.status, 200, JSON.stringify(probed.body));
assert.equal(probed.body.skillId, skillId);
assert.deepEqual(probed.body.predicate, predicate);
assert.deepEqual(probed.body.violations, []);
assert.equal(probed.body.traceHash, traceHashOf(probed.body));
assert.equal((await post("/claims/nope/probe", {})).status, 404);
console.log("✓ 3b POST /claims/:id/probe runs the sandbox on the gateway");

const hashed = (b: Omit<TraceBundle, "traceHash" | "violations"> & Partial<TraceBundle>) => ({ ...b, violations: [], traceHash: traceHashOf(b) });
const bundle = hashed({ v: 1, skillId, predicate, runtime: { node: process.version, image: "sigil-sandbox:node22", shim: SHIM_VERSION }, input: { argv: [], stdin: "" }, events: [] });
const disputeWith = (nullifier: string, b: unknown = bundle) => ({ by: disputer, counterBond: "2500000", traceBundle: b, arcTxHash: "", worldProof: { mock: true, nullifier } });
const live = async () => (await json(`/skills/${skillId}`)).body.claims[0].status;

// evidence for another skill, for a different predicate, or not covered by its own hash: rejected, claim untouched.
const wrongSkill = await post(`/claims/${claim.body.id}/dispute`, disputeWith(M, hashed({ ...bundle, skillId: `${skillId.slice(0, -1)}0` })));
assert.equal(wrongSkill.status, 409, JSON.stringify(wrongSkill.body));
const wrongPredicate = await post(`/claims/${claim.body.id}/dispute`, disputeWith(M, hashed({ ...bundle, predicate: { kind: "NO_ENV_READ_OUTSIDE", allowlist: ["LOG_LEVEL"] } })));
assert.equal(wrongPredicate.status, 409, JSON.stringify(wrongPredicate.body));
const tampered = await post(`/claims/${claim.body.id}/dispute`, disputeWith(M, { ...bundle, events: [{ seq: 1, kind: "env", target: "SIGIL_CANARY_AWS", stack: [] }] }));
assert.equal(tampered.status, 400, JSON.stringify(tampered.body));
assert.equal(await live(), "LIVE");
console.log("✓ 4a dispute evidence bound to the claim: wrong skillId 409, wrong predicate 409, tampered traceHash 400, claim still LIVE");

const same = await post(`/claims/${claim.body.id}/dispute`, disputeWith(N));
assert.equal(same.status, 409, JSON.stringify(same.body));
const other = await post(`/claims/${claim.body.id}/dispute`, disputeWith(M));
assert.equal(other.status, 201, JSON.stringify(other.body));
assert.equal((await json(`/skills/${skillId}`)).body.claims[0].status, "DISPUTED");
assert.equal((await json("/skills")).body.skills.find((s: { id: string }) => s.id === skillId)?.totalStaked, "10000000");
console.log("✓ 4 World both-sides: same nullifier -> 409, different nullifier -> 201");

// ── 5. rp-context: signed when WORLD_RP_SIGNING_KEY is set, explicit 500 otherwise ──
const rp = await post("/world/rp-context", { action: "sigil-participant" });
assert(rp.status === 200 ? typeof rp.body.signature === "string" : rp.status === 500 && /not configured/.test(rp.body.error), JSON.stringify(rp.body));
console.log(`✓ 5 rp-context: ${rp.status === 200 ? "signed" : "RP signing key not configured (500)"}`);

// ── the allowlist-free kinds (placed last: the 201 adds a claim, which would shift the per-skill totals asserted above) ──
// the allowlist-free kinds: accepted empty, refused with entries (a subprocess is never allowed, so there is nothing to allow-list)
assert.equal((await post("/claims", { skillId, predicate: { kind: "NO_CHILD_PROCESS", allowlist: ["git"] }, stakeAmount: "10000000", stakedBy: staker, arcTxHash: "", nonce: "np1", worldProof: { mock: true, nullifier: N } })).status, 400);
assert.equal((await post("/claims", { skillId, predicate: { kind: "NO_DYNAMIC_CODE", allowlist: [] }, stakeAmount: "10000000", stakedBy: staker, arcTxHash: "", nonce: "np2", worldProof: { mock: true, nullifier: N } })).status, 201);
server.close();
console.log("ALL PASSED");
process.exit(0); // the Hedera SDK clients keep gRPC channels open

async function waitFor(what: string, ok: () => Promise<boolean>, ms = 60_000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await ok().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** 0.0.x@sec.nanos -> mirror-node id 0.0.x-sec-nanos; returns the mirror record or null. */
async function mirrorTransaction(txId: string): Promise<{ result: string; charged_tx_fee: number; transaction_id: string } | null> {
  const id = txId.includes("@") ? txId.replace("@", "-").replace(/\.(\d+)$/, "-$1") : txId;
  let found: { result: string; charged_tx_fee: number; transaction_id: string } | null = null;
  await waitFor(`mirror node tx ${id}`, async () => {
    const r = await fetch(`${MIRROR}/api/v1/transactions/${id}`);
    if (!r.ok) return false;
    found = ((await r.json()) as { transactions?: typeof found[] }).transactions?.[0] ?? null;
    return !!found;
  }, 30_000).catch((e) => console.warn(`  ${(e as Error).message}`));
  return found;
}
