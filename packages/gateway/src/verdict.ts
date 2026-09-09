// Verifier: re-runs a dispute's trace in the sandbox and posts the verdict to the resolver on Arc.
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { verifyTrace } from "@sigil/sandbox";
import { OUTCOME_REASON, type Outcome, type Resolution } from "@sigil/shared";
import { HttpError, hcs, registryTopic, save, state } from "./state.ts";

// Hand-written from ARCHITECTURE.md "CONTRACT — SigilStake ABI".
// Both resolvers take the same evidence, spelled their own way; RESOLVER_KIND picks which call this file makes and is
// the only place either vocabulary appears (spec §6). Everything else — the API, the logs, HCS — says reproduced/observedHash.
export const RESOLVER_ABI = parseAbi([
  "function submitVerdict(bytes32 claimId, bytes32 observedHash, bool reproduced)", // DisputeResolver
  "function attest(bytes32 claimId, bool holds)", // AttestorResolver: holds = the claim survived = !reproduced
]);
export const resolverKind = (): "dispute" | "attestor" => {
  const kind = process.env.RESOLVER_KIND || "dispute";
  if (kind !== "dispute" && kind !== "attestor") throw new HttpError(500, `RESOLVER_KIND must be "dispute" or "attestor", got "${kind}"`);
  return kind;
};
export const STAKE_ABI = parseAbi([
  "function openClaim(bytes32 claimId, uint256 amount)",
  "function minStake() view returns (uint256)",
  "function stakes(bytes32) view returns (bytes32 claimId, address staker, uint256 amount, address disputer, uint256 counterBond, uint8 state, uint64 createdAt, bytes32 traceHash)",
]);
export const ERC20_ABI = parseAbi(["function approve(address spender, uint256 amount) returns (bool)", "function balanceOf(address) view returns (uint256)"]);

export const arcChain = () => defineChain({
  id: Number(process.env.ARC_CHAIN_ID ?? 5042002),
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, // TODO(verify): Arc gas-token decimals; display-only for viem
  rpcUrls: { default: { http: [process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.network"] } },
  blockExplorers: { default: { name: "Arcscan", url: process.env.ARC_EXPLORER_URL ?? "https://testnet.arcscan.app" } },
});

export function arcClients(privateKey: Hex) {
  const chain = arcChain();
  const account = privateKeyToAccount(privateKey);
  return { account, wallet: createWalletClient({ account, chain, transport: http() }), pub: createPublicClient({ chain, transport: http() }) };
}

/** POST /claims/:id/resolve */
export async function resolveClaim(claimId: string) {
  const claim = state.claims[claimId];
  if (!claim) throw new HttpError(404, "claim not found");
  const dispute = Object.values(state.disputes).find((d) => d.claimId === claimId && d.status === "OPEN");
  if (!dispute) throw new HttpError(409, "claim has no open dispute");
  const skill = state.skills[claim.skillId];
  if (!skill) throw new HttpError(404, "skill not found");
  // ponytail: source comes from the local index; downloading it from HCS-1 (skill.sourceUri) is the upgrade path.
  const { reproduced, observedHash } = await verifyTrace(dispute.traceBundle, skill.source);
  const observed = (observedHash.startsWith("0x") ? observedHash : `0x${observedHash}`) as Hex;

  let verdictTxHash = "";
  const resolver = process.env.SIGIL_RESOLVER_ADDRESS as Hex | undefined;
  const key = process.env.VERIFIER_KEY as Hex | undefined;
  const kind = resolverKind();
  const stakeAddress = process.env.SIGIL_STAKE_ADDRESS as Hex | undefined;
  // A claim recorded without escrow has no stake on Arc (stakes(claimId).state == 0): nothing to post a verdict for.
  const escrowed = resolver && key && stakeAddress
    ? Number((await arcClients(key).pub.readContract({ address: stakeAddress, abi: STAKE_ABI, functionName: "stakes", args: [claimId as Hex] }))[5]) !== 0
    : false;
  if (resolver && key && !escrowed) {
    console.warn(`[verdict] ${claimId} is an off-chain record (no escrow on Arc): verdict reproduced=${reproduced} kept off-chain, nothing posted`);
  } else if (resolver && key) {
    const { wallet, pub } = arcClients(key);
    verdictTxHash = kind === "attestor"
      ? await wallet.writeContract({ address: resolver, abi: RESOLVER_ABI, functionName: "attest", args: [claimId as Hex, !reproduced] })
      : await wallet.writeContract({ address: resolver, abi: RESOLVER_ABI, functionName: "submitVerdict", args: [claimId as Hex, observed, reproduced] });
    await pub.waitForTransactionReceipt({ hash: verdictTxHash as Hex });
    console.log(`[verdict] ${claimId} reproduced=${reproduced} posted to the ${kind} resolver ${process.env.ARC_EXPLORER_URL ?? ""}/tx/${verdictTxHash}`);
  } else {
    console.warn(`[verdict] SIGIL_RESOLVER_ADDRESS/VERIFIER_KEY empty: verdict for ${claimId} (reproduced=${reproduced}) NOT posted on Arc`);
  }
  state.verdicts[claimId] = { reproduced, observedHash, verdictTxHash };
  save();
  return { reproduced, observedHash, verdictTxHash };
}

/** POST /claims/:id/resolved — caller has executed resolve() on-chain; record the outcome. */
export async function recordResolved(claimId: string, arcTxHash: string): Promise<Resolution> {
  const claim = state.claims[claimId];
  if (!claim) throw new HttpError(404, "claim not found");
  if (state.resolutions.some((r) => r.claimId === claimId)) throw new HttpError(409, "claim already resolved");
  const verdict = state.verdicts[claimId];
  if (!verdict) throw new HttpError(409, "no verdict yet: call POST /claims/:id/resolve first");
  const dispute = Object.values(state.disputes).find((d) => d.claimId === claimId && d.status === "OPEN") ?? null;
  // ponytail: outcome is the verdict this gateway posted; the on-chain resolver decides on the same bit, so they agree by
  // construction. Reading the Resolved event from arcTxHash is the upgrade path once the contract address is fixed.
  const outcome: Outcome = verdict.reproduced ? "CLAIM_BROKEN" : "CLAIM_UPHELD";
  claim.status = verdict.reproduced ? "BROKEN" : "UPHELD";
  if (dispute) dispute.status = verdict.reproduced ? "SUSTAINED" : "REJECTED";
  const resolution: Resolution = {
    claimId, disputeId: dispute?.id ?? null, outcome,
    winner: verdict.reproduced ? dispute?.by ?? "" : claim.stakedBy,
    reason: OUTCOME_REASON[outcome], arcTxHash, hcsSequence: 0,
  };
  resolution.hcsSequence = await hcs(claim.hcsTopicId || registryTopic(), "RESOLVED", claimId, resolution);
  state.resolutions.push(resolution);
  save();
  return resolution;
}
