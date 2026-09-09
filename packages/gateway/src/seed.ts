// Seed (build-spec §14): registers the six fixture skills and opens their claims. Run via `pnpm seed` at the repo root
// against a running gateway (GATEWAY_URL). Claims use mock World proofs, so the gateway must run with WORLD_MODE=mock.
import "./env.ts";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hex } from "viem";
import { runSkill } from "@sigil/sandbox";
import { baseToUsdc, claimIdOf, usdcToBase, type Predicate, type SkillManifest, type SkillSource } from "@sigil/shared";
import { ERC20_ABI, STAKE_ABI, arcClients } from "./verdict.ts";

interface Fixture { name: string; author: string; manifest: SkillManifest; claims?: { predicate: Predicate; stakeAmount: string }[]; files: Record<string, string> }

const GATEWAY = process.env.GATEWAY_URL ?? "http://localhost:4021";
const FIXTURES = fileURLToPath(new URL("../../sandbox/fixtures/skills", import.meta.url));
const FIXTURES_TMP = fileURLToPath(new URL("../fixtures-tmp/skills.json", import.meta.url));

function loadFixtures(): Fixture[] {
  if (existsSync(FIXTURES)) {
    return readdirSync(FIXTURES).sort().map((dir) => {
      const d = join(FIXTURES, dir);
      const meta = JSON.parse(readFileSync(join(d, "skill.json"), "utf8")) as Omit<Fixture, "files">;
      const files = Object.fromEntries(readdirSync(d).filter((f) => f !== "skill.json").map((f) => [f, readFileSync(join(d, f), "utf8")]));
      return { ...meta, files };
    });
  }
  console.warn(`[seed] ${FIXTURES} not found: using ${FIXTURES_TMP} (temporary equivalents until the sandbox fixtures land)`);
  return JSON.parse(readFileSync(FIXTURES_TMP, "utf8")) as Fixture[];
}

async function post(path: string, body: unknown): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(GATEWAY + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

// spec §14: the demo needs BOTH outcomes. cloud-helper's claim is left LIVE and undisputed so the live demo can
// break it; json-pretty's first claim gets a dispute that FAILS — a benign run of an honest skill reproduces
// nothing, so the verifier returns reproduced=false and the staker keeps the pot.
const BENIGN = "json-pretty";
const DISPUTER = `0x${"dd".repeat(20)}`;
const DISPUTER_NULLIFIER = `0x${createHash("sha256").update("seed:disputer").digest("hex")}`;

interface Benign { skillId: string; source: SkillSource; predicate: Predicate; claimId: string; stakeAmount: bigint }

/** POST that treats 409 as "already seeded" so the whole sequence is idempotent. */
async function step(path: string, body: unknown, what: string): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await post(path, body);
  if (r.status === 409) { console.log(`[seed]   ${what}: already seeded (${r.body.error})`); return null; }
  if (r.status >= 300) throw new Error(`POST ${path} (${what}): ${r.status} ${r.body.error}`);
  return r.body;
}

async function seedFailedDispute(b: Benign): Promise<void> {
  // The bundle carries the claim's own skillId and predicate, which is what the dispute route now requires.
  const { stdout: _o, stderr: _e, exitCode: _c, ...bundle } = await runSkill({
    skillId: b.skillId, source: b.source, predicate: b.predicate, input: { argv: [], stdin: '{"query":"hello"}' },
  });
  console.log(`[seed] failed dispute on ${BENIGN}: benign run -> ${bundle.violations.length} violation(s), traceHash ${bundle.traceHash.slice(0, 16)}…`);
  // ponytail: the counter-bond is recorded off-chain (arcTxHash ""); a real disputer needs its own funded Arc
  // account, and seed only holds the staker's key. Upgrade: a second funded key in .env.
  const bond = ((b.stakeAmount * 2500n) / 10000n).toString();
  await step(`/claims/${b.claimId}/dispute`, { by: DISPUTER, counterBond: bond, traceBundle: bundle, arcTxHash: "", worldProof: { mock: true, nullifier: DISPUTER_NULLIFIER } }, "dispute");
  const verdict = await step(`/claims/${b.claimId}/resolve`, {}, "resolve");
  if (verdict) console.log(`[seed]   verifier re-ran the bundle: reproduced=${verdict.reproduced} observedHash ${String(verdict.observedHash).slice(0, 16)}…`);
  const resolution = await step(`/claims/${b.claimId}/resolved`, { arcTxHash: "" }, "resolved");
  if (resolution) console.log(`[seed]   ${resolution.outcome}: winner ${resolution.winner} keeps ${baseToUsdc(b.stakeAmount)} + ${baseToUsdc(bond)} USDC`);
}

async function printRegistry(): Promise<void> {
  const r = await fetch(`${GATEWAY}/skills`);
  const { skills } = (await r.json()) as { skills: { name: string; id: string; totalStaked: string; liveClaims: number; disputes: number; sustainedDisputes: number }[] };
  console.table(skills.map((s) => ({
    skill: s.name, id: s.id.slice(0, 10), stakedUSDC: baseToUsdc(s.totalStaked),
    liveClaims: s.liveClaims, disputes: s.disputes, sustained: s.sustainedDisputes,
  })));
}

export async function seed(): Promise<void> {
  const stakeAddress = (process.env.SIGIL_STAKE_ADDRESS ?? "") as Hex | "";
  const deployerKey = process.env.ARC_DEPLOYER_KEY as Hex | undefined;
  const arc = deployerKey ? arcClients(deployerKey) : null;
  const stakedBy = arc?.account.address ?? `0x${"00".repeat(20)}`;
  if (!stakeAddress) console.warn("[seed] SIGIL_STAKE_ADDRESS is empty: claims are recorded WITHOUT on-chain escrow (arcTxHash \"\")");
  if (!arc) console.warn("[seed] ARC_DEPLOYER_KEY is empty: stakedBy is the zero address");

  // A faucet drips ~20 USDC; the fixture stakes add up to 595. SEED_STAKE_USDC overrides every stake with one
  // amount and SEED_ONCHAIN_SKILLS limits real escrow to the named skills (the rest stay labelled off-chain records).
  const flat = process.env.SEED_STAKE_USDC ? usdcToBase(process.env.SEED_STAKE_USDC) : null;
  const onchainSkills = process.env.SEED_ONCHAIN_SKILLS?.split(",").map((s) => s.trim()).filter(Boolean) ?? null; // null = all
  const escrowed = (name: string) => !!stakeAddress && !!arc && (onchainSkills === null || onchainSkills.includes(name));
  const usdc = (process.env.ARC_USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000") as Hex;
  const fixtures = loadFixtures();
  if (stakeAddress && arc) {
    const planned = fixtures.filter((f) => escrowed(f.name)).flatMap((f) => (f.claims ?? []).map((c) => flat ?? usdcToBase(c.stakeAmount)));
    const need = planned.reduce((a, b) => a + b, 0n);
    const balance = await arc.pub.readContract({ address: usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [arc.account.address] });
    console.log(`[seed] escrow: ${planned.length} claim(s) on Arc need ${baseToUsdc(need)} USDC; deployer ${arc.account.address} holds ${baseToUsdc(balance)} USDC`);
    if (balance < need) throw new Error(`[seed] deployer holds ${baseToUsdc(balance)} USDC but ${baseToUsdc(need)} USDC is needed: fund it at faucet.circle.com (Arc Testnet) or lower SEED_STAKE_USDC / narrow SEED_ONCHAIN_SKILLS`);
    const minStake = await arc.pub.readContract({ address: stakeAddress, abi: STAKE_ABI, functionName: "minStake" });
    const low = planned.find((a) => a < minStake);
    if (low !== undefined) throw new Error(`[seed] a stake of ${baseToUsdc(low)} USDC is below SigilStake.minStake ${baseToUsdc(minStake)} USDC`);
    if (escrowed(BENIGN)) console.warn(`[seed] ${BENIGN} is escrowed on Arc but its failing dispute is an off-chain record (no funded disputer key), so that stake stays Live on-chain; prefer SEED_ONCHAIN_SKILLS=cloud-helper`);
  }

  let benign: Benign | null = null;
  for (const f of fixtures) {
    const source = { entrypoint: f.manifest.entrypoint, files: f.files };
    const skill = await post("/skills", { name: f.name, author: f.author, manifest: f.manifest, source });
    if (skill.status >= 300) throw new Error(`POST /skills ${f.name}: ${skill.status} ${skill.body.error}`);
    console.log(`[seed] skill ${f.name} -> ${skill.body.id}${skill.status === 200 ? " (already registered)" : ""}`);
    const existing = new Set(((await (await fetch(`${GATEWAY}/skills/${skill.body.id}`)).json()) as { claims: { id: string }[] }).claims.map((c) => c.id));
    const nullifier = `0x${createHash("sha256").update(`seed:${f.name}`).digest("hex")}`;
    for (const [i, c] of (f.claims ?? []).entries()) {
      const amount = flat ?? usdcToBase(c.stakeAmount);
      const nonce = `seed:${process.env.SEED_RUN ? `${process.env.SEED_RUN}:` : ""}${f.name}:${i}`; // SEED_RUN=take2 → new claim ids → new escrow without redeploying
      const claimId = claimIdOf(skill.body.id, c.predicate, stakedBy, nonce);
      if (f.name === BENIGN && i === 0) benign = { skillId: skill.body.id, source, predicate: c.predicate, claimId, stakeAmount: amount };
      if (existing.has(claimId)) { console.log(`[seed]   claim ${claimId} already exists`); continue; }
      let arcTxHash = "";
      if (stakeAddress && arc && !escrowed(f.name)) console.log(`[seed]   ${f.name} claim recorded off-chain (not in SEED_ONCHAIN_SKILLS)`);
      if (escrowed(f.name) && arc && stakeAddress) {
        // Re-run safety: openClaim reverts once the id exists on-chain, so look before leaping.
        const [, , , , , state] = await arc.pub.readContract({ address: stakeAddress, abi: STAKE_ABI, functionName: "stakes", args: [claimId] });
        if (state !== 0) console.log(`[seed]   ${claimId} already escrowed on Arc (state ${state})`);
        else {
          const approve = await arc.wallet.writeContract({ address: usdc, abi: ERC20_ABI, functionName: "approve", args: [stakeAddress, amount] });
          await arc.pub.waitForTransactionReceipt({ hash: approve });
          arcTxHash = await arc.wallet.writeContract({ address: stakeAddress, abi: STAKE_ABI, functionName: "openClaim", args: [claimId, amount] });
          await arc.pub.waitForTransactionReceipt({ hash: arcTxHash as Hex });
          console.log(`[seed]   openClaim ${claimId} ${baseToUsdc(amount)} USDC ${process.env.ARC_EXPLORER_URL ?? ""}/tx/${arcTxHash}`);
        }
      }
      const claim = await post("/claims", { skillId: skill.body.id, predicate: c.predicate, stakeAmount: amount.toString(), stakedBy, arcTxHash, nonce, worldProof: { mock: true, nullifier } });
      if (claim.status === 409) { console.log(`[seed]   claim ${claimId} already exists`); continue; }
      if (claim.status >= 300) throw new Error(`POST /claims ${f.name}#${i}: ${claim.status} ${claim.body.error}`);
      console.log(`[seed]   claim ${claim.body.id} ${c.predicate.kind} ${baseToUsdc(amount)} USDC -> ${claim.body.status}${claim.body.hcsTopicId ? ` topic ${claim.body.hcsTopicId}` : ""}`);
    }
  }
  if (benign) await seedFailedDispute(benign);
  else console.warn(`[seed] ${BENIGN} fixture not found: the failed-dispute outcome is MISSING from the demo`);
  await printRegistry();
  console.log("[seed] done");
}

if (process.argv[1] && process.argv[1].endsWith("gateway/src/seed.ts")) void seed();
