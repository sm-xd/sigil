// @sigil/agent — discover → decide → pay (x402 on Hedera via Blocky402) → install (sandbox) → auto-dispute (Arc, own wallet).
// Run: tsx src/index.ts [--once]. Every decision is printed; nothing here asks a model to adjudicate.
import { config } from "dotenv";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { baseToUsdc, sha256Hex, type Claim, type Dispute, type Resolution, type TraceBundle } from "@sigil/shared";
import { runSkill } from "@sigil/sandbox";
import { decide, describePolicy, getSkill, listSkills, policyFromEnv, type Policy } from "./discover.ts";
import { fetchSource, hashscan, holdsLicense, payerFromEnv, type Payer } from "./pay.ts";
import { probe, proposeInputs, type Run } from "./install.ts";
import { ARC, walletFromEnv, type Wallet } from "./wallet.ts";

export interface Deps {
  gateway: string;
  policy: Policy;
  payer: Payer | null; // null → Hedera agent account not configured
  wallet: Wallet;
  stakeAddress: string; // "" → on-chain steps skipped, loudly
  explorer: string;
  mirror: string;
  worldProof: Record<string, unknown>;
  run: Run;
  llmKey?: string;
  log: (s: string) => void;
  installed: Set<string>; // ponytail: in-memory; the license NFT is the durable record — after a restart the gateway serves free, no double-pay
}

export interface Tally {
  paid: number;
  disputed: number;
  resolved: number;
}

export function depsFromEnv(env: NodeJS.ProcessEnv = process.env, log: (s: string) => void = console.log): Deps {
  const nullifier = env.AGENT_HUMAN_PROOF_REF || "0x" + sha256Hex("sigil-agent-operator");
  return {
    gateway: env.GATEWAY_URL || "http://localhost:4021",
    policy: policyFromEnv(env),
    payer: payerFromEnv(env, log),
    wallet: walletFromEnv(env, log),
    stakeAddress: env.SIGIL_STAKE_ADDRESS || "",
    explorer: env.ARC_EXPLORER_URL || ARC.explorer,
    mirror: env.HEDERA_MIRROR_URL || "https://testnet.mirrornode.hedera.com",
    // mock: the gateway enforces the both-sides rule on the nullifier alone.
    // TODO(verify) sandbox mode: that the gateway accepts a pre-verified operator nullifier without a fresh IDKit proof.
    worldProof: env.WORLD_MODE === "mock" ? { mock: true, nullifier } : { nullifier },
    run: runSkill,
    llmKey: env.OPENAI_API_KEY || undefined,
    log,
    installed: new Set(),
  };
}

async function post<T>(gateway: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${gateway}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export async function runOnce(d: Deps): Promise<Tally> {
  const { log } = d;
  const tally: Tally = { paid: 0, disputed: 0, resolved: 0 };
  log(`── policy ── ${describePolicy(d.policy, !!d.stakeAddress)}`);
  log(`── wallet ── ${d.wallet.label} ${await d.wallet.address()} · Arc chain ${ARC.chainId}`);
  log(d.payer ? `── x402 ── paying as Hedera ${d.payer.accountId}, settled by Blocky402` : `── x402 ── NOT CONFIGURED: HEDERA_AGENT_ACCOUNT_ID / HEDERA_AGENT_KEY empty → 402s cannot be paid`);
  const skills = await listSkills(d.gateway);
  log(`── discover ── ${skills.length} skill(s) from ${d.gateway}`);
  for (const s of skills) {
    const { install, reasons } = decide(s, d.policy, !!d.stakeAddress);
    log(`  ${install ? "✓" : "✗"} ${s.name} (${s.id.slice(0, 8)})`);
    for (const r of reasons) log(`      ${r}`);
    log(`      → ${install ? (d.installed.has(s.id) ? "already installed" : "install") : "skip"}`);
    if (!install || d.installed.has(s.id)) continue;
    try {
      await installSkill(d, s.id, tally);
    } catch (e) {
      log(`  !! ${s.name}: ${(e as Error).message}`);
    }
  }
  return tally;
}

async function installSkill(d: Deps, skillId: string, tally: Tally) {
  const { log } = d;
  log(`── pay ── GET /skills/${skillId.slice(0, 8)}…/source`);
  const { body, settlement } = await fetchSource(d.gateway, skillId, d.payer);
  const detail = await getSkill(d.gateway, skillId);
  if (settlement) {
    tally.paid++;
    log(`  x402: settled · ${settlement.network} · tx ${settlement.transaction}${settlement.amount ? ` · ${baseToUsdc(settlement.amount)} USDC` : ""}`);
    log(`        ${hashscan(settlement.transaction)}`);
    const minted = d.payer ? await holdsLicense(d.mirror, detail.license.tokenId, d.payer.accountId) : false;
    log(`  license NFT ${detail.license.tokenId}: ${minted ? `minted to ${d.payer!.accountId} (mirror node confirms)` : "not visible on the mirror node yet"}`);
  } else {
    log(`  x402: served free — license NFT already held, no 402`);
  }
  d.installed.add(skillId);
  log(`── install ── ${Object.keys(body.source.files).length} file(s), entrypoint ${body.source.entrypoint}, ${detail.claims.length} claim(s)`);
  const extra = d.llmKey ? await proposeInputs(body.source, d.llmKey, log) : [];
  const hits = await probe({ skillId, source: body.source }, detail.claims, d.run, extra, log);
  if (!hits.length) log(`  no violations — every claim holds`);
  for (const { claim, bundle } of hits) await disputeClaim(d, claim, bundle, tally);
}

// the money shot: the agent stakes its own capital on evidence it just produced, with no human involved.
async function disputeClaim(d: Deps, claim: Claim, bundle: TraceBundle, tally: Tally) {
  const { log, wallet } = d;
  const stake = BigInt(claim.stakeAmount);
  const bps = d.stakeAddress ? await wallet.minBondBps() : 2500n;
  const bond = (stake * (bps > 2500n ? bps : 2500n)) / 10000n; // max(minBond, 25% of stake)
  const by = await wallet.address();
  log(`── dispute ── claim ${claim.id.slice(0, 10)}… ${claim.predicate.kind} · ${bundle.violations.length} violation(s) · traceHash ${bundle.traceHash}`);
  log(`  stake ${baseToUsdc(stake)} USDC → counter-bond ${baseToUsdc(bond)} USDC from ${wallet.label} ${by}`);
  let before = 0n;
  let arcTxHash = "";
  // A claim recorded without escrow (arcTxHash "") has no stake on Arc: dispute() would revert "not live",
  // so the dispute is recorded with the gateway only and labelled as such.
  const escrowed = d.stakeAddress ? (await wallet.stakeState(claim.id)) === 1 : false;
  if (!d.stakeAddress) {
    log(`  !! SIGIL_STAKE_ADDRESS empty → SKIPPING approve/dispute/resolve on Arc; gateway + HCS steps still run`);
  } else if (!escrowed) {
    log(`  !! claim has no live escrow on Arc (off-chain record) → dispute recorded with the gateway only, no counter-bond moves`);
  } else {
    before = await wallet.usdcBalance();
    log(`  agent USDC before: ${baseToUsdc(before)}`);
    const approveTx = await wallet.approveUsdc(d.stakeAddress, bond);
    log(`  approve(SigilStake, ${baseToUsdc(bond)}) ${d.explorer}/tx/${approveTx}`);
    arcTxHash = await wallet.dispute(claim.id, bond, bundle.traceHash);
    log(`  dispute(claimId, bond, traceHash) ${d.explorer}/tx/${arcTxHash}`);
  }
  const dispute = await post<Dispute>(d.gateway, `/claims/${claim.id}/dispute`, {
    by,
    counterBond: bond.toString(),
    traceBundle: bundle,
    arcTxHash,
    worldProof: d.worldProof,
  });
  tally.disputed++;
  log(`  HCS DISPUTE_OPENED · evidence ${dispute.evidenceUri} · traceHash ${dispute.traceHash}`);
  const verdict = await post<{ reproduced: boolean; observedHash: string }>(d.gateway, `/claims/${claim.id}/resolve`, {});
  log(`── resolve ── verifier re-ran the bundle: ${JSON.stringify({ reproduced: verdict.reproduced, observedHash: verdict.observedHash })}`);
  let resolveTx = "";
  if (escrowed) {
    resolveTx = await wallet.resolve(claim.id);
    log(`  resolve(claimId) ${d.explorer}/tx/${resolveTx}`);
  }
  const r = await post<Resolution>(d.gateway, `/claims/${claim.id}/resolved`, { arcTxHash: resolveTx });
  tally.resolved++;
  log(`── settled ── ${r.outcome} · winner ${r.winner}${r.winner.toLowerCase() === by.toLowerCase() ? " (this agent)" : " (staker)"}`);
  log(`  stake         ${baseToUsdc(stake).padStart(14)} USDC`);
  log(`  counter-bond  ${baseToUsdc(bond).padStart(14)} USDC`);
  log(`  payout        ${baseToUsdc(stake + bond).padStart(14)} USDC → ${r.winner}`);
  if (escrowed) {
    const after = await wallet.usdcBalance();
    log(`  agent USDC ${baseToUsdc(before)} → ${baseToUsdc(after)} (${after >= before ? "+" : "-"}${baseToUsdc(after >= before ? after - before : before - after)})`);
    log(`  ${d.explorer}/tx/${r.arcTxHash || resolveTx}`);
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<Tally> {
  config({ path: resolvePath(import.meta.dirname, "../../../.env") });
  const d = depsFromEnv();
  for (;;) {
    const t = await runOnce(d);
    if (argv.includes("--once")) return t;
    d.log(`── sleeping 30s ──`);
    await new Promise((r) => setTimeout(r, 30_000));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
