// Deploys DisputeResolver + SigilStake to Arc and writes their addresses into the repo-root .env.
// Run from the repo root: `pnpm tsx scripts/deploy.ts`. Needs `forge` on PATH and a funded ARC_DEPLOYER_KEY
// (gas on Arc is USDC; testnet faucet: https://faucet.circle.com, select Arc Testnet).
// Cooldown/min-stake/min-bond live in packages/contracts-arc/script/Deploy.s.sol.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const envPath = path.join(root, ".env");
const pkg = path.join(root, "packages", "contracts-arc");

// .env is the source of truth; process.env may override (e.g. ARC_RPC_URL/ARC_CHAIN_ID for a local anvil).
const envText = readFileSync(envPath, "utf8");
const fileEnv: Record<string, string> = {};
for (const line of envText.split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (m) fileEnv[m[1]] = m[2].replace(/\s+#.*$/, "").trim();
}
const env = { ...fileEnv, ...process.env } as Record<string, string>;
const need = (k: string): string => {
  if (!env[k]) throw new Error(`${k} is empty in ${envPath}`);
  return env[k];
};

const rpc = need("ARC_RPC_URL");
for (const k of ["ARC_DEPLOYER_KEY", "ARC_USDC_ADDRESS", "VERIFIER_ADDRESS"]) need(k);
const chainId = env.ARC_CHAIN_ID || "5042002";
const explorer = env.ARC_EXPLORER_URL || "https://testnet.arcscan.app";

// Deploy.s.sol signs with vm.startBroadcast(ARC_DEPLOYER_KEY) from env; the key never goes on the command line.
execFileSync("forge", ["script", "script/Deploy.s.sol", "--rpc-url", rpc, "--broadcast"], {
  cwd: pkg,
  stdio: "inherit",
  env,
});

const run = JSON.parse(readFileSync(path.join(pkg, "broadcast", "Deploy.s.sol", chainId, "run-latest.json"), "utf8"));
const deployed = (name: string): string => {
  const tx = run.transactions.find((t: { transactionType: string; contractName: string }) =>
    t.transactionType === "CREATE" && t.contractName === name,
  );
  if (!tx) throw new Error(`no CREATE for ${name} in run-latest.json`);
  return tx.contractAddress as string;
};
const addrs = {
  SIGIL_RESOLVER_ADDRESS: deployed("DisputeResolver"),
  SIGIL_STAKE_ADDRESS: deployed("SigilStake"),
};

let out = envText;
for (const [k, v] of Object.entries(addrs)) {
  const line = new RegExp(`^${k}=.*$`, "m");
  out = line.test(out) ? out.replace(line, `${k}=${v}`) : `${out.trimEnd()}\n${k}=${v}\n`;
}
writeFileSync(envPath, out);

for (const [k, v] of Object.entries(addrs)) console.log(`${k}=${v}  ${explorer}/address/${v}`);
console.log(`wrote ${envPath}`);
