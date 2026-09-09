// The agent's own wallet on Arc. One interface, two backends (AGENT_WALLET_BACKEND=circle|local).
//   circle — Circle Agent Stack wallet via `circle wallet execute` (the Arc requirement).
//   local  — viem signer with AGENT_ARC_KEY; fallback so the demo runs before `circle wallet login`.
import { spawn } from "node:child_process";
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface Wallet {
  label: string;
  address(): Promise<Hex>;
  usdcBalance(): Promise<bigint>;
  minBondBps(): Promise<bigint>;
  /** SigilStake.stakes(claimId).state: 0 None, 1 Live, 2 Disputed, 3 Resolved. */
  stakeState(claimId: string): Promise<number>;
  approveUsdc(spender: string, amount: bigint): Promise<string>;
  dispute(claimId: string, bond: bigint, traceHash: string): Promise<string>;
  resolve(claimId: string): Promise<string>;
}

export const ARC = {
  chainId: 5042002,
  rpc: "https://rpc.testnet.arc.network",
  usdc: "0x3600000000000000000000000000000000000000" as Hex, // 6dp
  explorer: "https://testnet.arcscan.app",
};

// ARCHITECTURE.md — CONTRACT: SigilStake ABI (the subset the agent calls).
export const SIGIL_STAKE_ABI = parseAbi([
  "function dispute(bytes32 claimId, uint256 counterBond, bytes32 traceHash)",
  "function resolve(bytes32 claimId)",
  "function minBondBps() view returns (uint256)",
  "function stakes(bytes32) view returns (bytes32 claimId, address staker, uint256 amount, address disputer, uint256 counterBond, uint8 state, uint64 createdAt, bytes32 traceHash)",
]);
export const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);

export const bytes32 = (h: string): Hex => `0x${h.replace(/^0x/, "").padStart(64, "0")}`;
export const disputeCalldata = (claimId: string, bond: bigint, traceHash: string) =>
  encodeFunctionData({ abi: SIGIL_STAKE_ABI, functionName: "dispute", args: [bytes32(claimId), bond, bytes32(traceHash)] });
export const resolveCalldata = (claimId: string) =>
  encodeFunctionData({ abi: SIGIL_STAKE_ABI, functionName: "resolve", args: [bytes32(claimId)] });
export const approveCalldata = (spender: string, amount: bigint) =>
  encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [spender as Hex, amount] });

/** Chain + public reads shared by both backends. */
function arc(env: NodeJS.ProcessEnv) {
  const rpc = env.ARC_RPC_URL || ARC.rpc;
  const chain = defineChain({
    id: ARC.chainId,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, // verified: 20 USDC from the faucet reads as 20e18 wei on Arc testnet
    rpcUrls: { default: { http: [rpc] } },
    blockExplorers: { default: { name: "Arcscan", url: env.ARC_EXPLORER_URL || ARC.explorer } },
  });
  const pub = createPublicClient({ chain, transport: http(rpc) });
  const usdc = (env.ARC_USDC_ADDRESS || ARC.usdc) as Hex;
  const stake = (): Hex => {
    if (!env.SIGIL_STAKE_ADDRESS) throw new Error("SIGIL_STAKE_ADDRESS empty");
    return env.SIGIL_STAKE_ADDRESS as Hex;
  };
  return {
    rpc,
    chain,
    pub,
    usdc,
    stake,
    balanceOf: (who: Hex) => pub.readContract({ address: usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [who] }),
    minBondBps: () => pub.readContract({ address: stake(), abi: SIGIL_STAKE_ABI, functionName: "minBondBps" }),
    stakeState: async (claimId: string) => Number((await pub.readContract({ address: stake(), abi: SIGIL_STAKE_ABI, functionName: "stakes", args: [claimId as Hex] }))[5]),
    wait: async (hash: string) => {
      if (/^0x[0-9a-fA-F]{64}$/.test(hash)) await pub.waitForTransactionReceipt({ hash: hash as Hex });
      return hash;
    },
  };
}

export function localWallet(env: NodeJS.ProcessEnv = process.env): Wallet {
  const key = env.AGENT_ARC_KEY as Hex | undefined;
  if (!key) throw new Error("AGENT_WALLET_BACKEND=local needs AGENT_ARC_KEY");
  const account = privateKeyToAccount(key);
  const a = arc(env);
  const wc = createWalletClient({ account, chain: a.chain, transport: http(a.rpc) });
  const send = async (to: Hex, data: Hex) => a.wait(await wc.sendTransaction({ to, data }));
  return {
    label: "LOCAL SIGNER (fallback)",
    address: async () => account.address,
    usdcBalance: () => a.balanceOf(account.address),
    minBondBps: a.minBondBps,
    stakeState: a.stakeState,
    approveUsdc: (spender, amount) => send(a.usdc, approveCalldata(spender, amount)),
    dispute: (claimId, bond, traceHash) => send(a.stake(), disputeCalldata(claimId, bond, traceHash)),
    resolve: (claimId) => send(a.stake(), resolveCalldata(claimId)),
  };
}

/** `circle wallet execute <sig> [params…] --contract --address --chain --rpc-url --output json` (verified help text). */
export function circleWallet(env: NodeJS.ProcessEnv = process.env, log: (s: string) => void = console.log): Wallet {
  const address = env.CIRCLE_WALLET_ADDRESS as Hex | undefined;
  const chain = env.CIRCLE_CHAIN;
  if (!address || !chain) {
    throw new Error("AGENT_WALLET_BACKEND=circle needs CIRCLE_WALLET_ADDRESS and CIRCLE_CHAIN (Arc testnet is `ARC-TESTNET` in `circle blockchain list`)");
  }
  const a = arc(env);
  const exec = async (contract: Hex, signature: string, ...params: string[]) => {
    const args = ["wallet", "execute", signature, ...params, "--contract", contract, "--address", address, "--chain", chain, "--rpc-url", a.rpc, "--output", "json"];
    log(`  circle ${args.join(" ")}`);
    const out = await runCircle(args);
    const json = JSON.parse(out) as { data?: Record<string, unknown> };
    const d = (json.data ?? json) as Record<string, any>;
    // Verified 2026-09-12 against @circle-fin/cli 1.0.0: `--output json` returns { data: { id, state: "COMPLETE", txHash, blockHash, blockHeight, networkFee, … } }
    // and only returns once the user operation is confirmed, so `txHash` is final when we read it.
    const hash = d.txHash ?? d.transactionHash ?? d.hash ?? d.transaction?.txHash ?? d.transaction?.hash;
    if (typeof hash !== "string") {
      // Fail loudly: recording a placeholder as arcTxHash would corrupt the audit trail.
      throw new Error(`circle wallet execute: no tx hash field in --output json (looked for txHash/transactionHash/hash/transaction.*). Raw: ${out.trim().slice(0, 400)}`);
    }
    return a.wait(hash);
  };
  return {
    label: "circle (Agent Stack wallet)",
    address: async () => address,
    usdcBalance: () => a.balanceOf(address),
    minBondBps: a.minBondBps,
    stakeState: a.stakeState,
    approveUsdc: (spender, amount) => exec(a.usdc, "approve(address,uint256)", spender, amount.toString()),
    dispute: (claimId, bond, traceHash) => exec(a.stake(), "dispute(bytes32,uint256,bytes32)", bytes32(claimId), bond.toString(), bytes32(traceHash)),
    resolve: (claimId) => exec(a.stake(), "resolve(bytes32)", bytes32(claimId)),
  };
}

export function walletFromEnv(env: NodeJS.ProcessEnv = process.env, log: (s: string) => void = console.log): Wallet {
  return env.AGENT_WALLET_BACKEND === "circle" ? circleWallet(env, log) : localWallet(env);
}

/** Spawn the global `circle` binary (no shell; stdin closed so a Terms prompt fails fast instead of hanging). */
function runCircle(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("circle", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve(out);
      const detail = err.split("\n").filter((l) => !/^\(node:\d+\)|^\(Use `node/.test(l.trim())).join("\n").trim() || out.trim();
      reject(new Error(`circle ${args[0]} ${args[1]} failed (exit ${code}): ${detail}`));
    });
  });
}
