// pnpm buy <skill name or id> — the consuming half of the agent, by hand: pay the x402 paywall once, take the licence,
// save the source under downloads/<name>/ and say how to run it. No probe, no dispute (that is `pnpm e2e`).
// Pays from HEDERA_AGENT_ACCOUNT_ID/KEY; E2E_FRESH_PAYER=1 pays from a throwaway account instead (a licence makes re-buys free).
import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
config({ path: new URL("../.env", import.meta.url).pathname });
const { createAccount, hashscanUrl, transferToken } = await import("../packages/hedera/src/index.ts");
const { fetchSource, hashscan, payerFromEnv, usdcBalance } = await import("../packages/agent/src/pay.ts");

const gateway = process.env.GATEWAY_URL || "http://localhost:4021";
const want = process.argv[2];
if (!want) { console.error("usage: pnpm buy <skill name or id>"); process.exit(2); }
const { skills } = (await (await fetch(`${gateway}/skills`)).json()) as { skills: { id: string; name: string }[] };
const skill = skills.find((s) => s.id === want || s.name === want);
if (!skill) { console.error(`buy: no skill "${want}" on ${gateway}; names: ${skills.map((s) => s.name).join(", ")}`); process.exit(2); }

if (process.env.E2E_FRESH_PAYER === "1") {
  const { accountId, privateKey } = await createAccount(5);
  console.log(`buy: fresh payer ${accountId} (5 HBAR, no licence yet) ${hashscanUrl("account", accountId)}`);
  const usdc = process.env.HEDERA_USDC_TOKEN_ID ?? "0.0.429274";
  const mirror = process.env.HEDERA_MIRROR_URL ?? "https://testnet.mirrornode.hedera.com";
  const from = process.env.HEDERA_AGENT_ACCOUNT_ID, fromKey = process.env.HEDERA_AGENT_KEY;
  if (from && fromKey && (await usdcBalance(mirror, usdc, from)) >= 2_000_000n) {
    const txId = await transferToken(usdc, from, fromKey, accountId, 2_000_000);
    console.log(`buy: fresh payer funded with 2 USDC (HTS ${usdc}) from ${from} ${hashscanUrl("transaction", txId)}`);
    await new Promise((r) => setTimeout(r, 4000)); // mirror-node lag before pay.ts reads the balance
  }
  process.env.HEDERA_AGENT_ACCOUNT_ID = accountId;
  process.env.HEDERA_AGENT_KEY = privateKey;
}
const payer = payerFromEnv(process.env, (s) => console.log(s));
if (!payer) { console.error("buy: set HEDERA_AGENT_ACCOUNT_ID and HEDERA_AGENT_KEY in .env, or E2E_FRESH_PAYER=1"); process.exit(2); }

console.log(`buy: ${skill.name} from ${gateway} as Hedera ${payer.accountId}`);
const { body, settlement } = await fetchSource(gateway, skill.id, payer);
if (settlement) console.log(`buy: paid · ${settlement.network} · tx ${settlement.transaction} ${hashscan(settlement.transaction)}`);
else console.log("buy: served free · this account already holds the licence NFT for it");

const dir = join("downloads", skill.name);
for (const [file, content] of Object.entries(body.source.files)) {
  await mkdir(join(dir, dirname(file)), { recursive: true });
  await writeFile(join(dir, file), content);
}
await writeFile(join(dir, "manifest.json"), JSON.stringify(body.manifest, null, 2) + "\n");
await writeFile(join(dir, "package.json"), '{ "type": "commonjs" }\n'); // skills are CommonJS; the repo root is "type": "module"
console.log(`buy: ${Object.keys(body.source.files).length} file(s) → ${dir}/ (entrypoint ${body.source.entrypoint})`);

if (settlement) {
  // The gateway fills the licence serial into its payments ledger once the HTS mint lands (a few seconds).
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const a = (await (await fetch(`${gateway}/skills/${skill.id}/access`)).json()) as { licenseToken: string; payments: { txId: string; licenseSerial?: number }[] };
    const p = a.payments.find((x) => x.txId === settlement.transaction);
    if (p?.licenseSerial) { console.log(`buy: licence NFT ${a.licenseToken} #${p.licenseSerial} minted to ${payer.accountId} · this account now reads the source free (X-Hedera-Account header)`); break; }
  }
}
console.log(`buy: run it     cd ${dir} && node ${body.source.entrypoint}`);
console.log(`buy: probe it   POLICY_MIN_STAKE_USDC=10 POLICY_MIN_CLAIM_AGE_SEC=0 pnpm --filter @sigil/agent once   (sandbox run + dispute if it misbehaves)`);
process.exit(0); // the Hedera SDK keeps gRPC channels open
