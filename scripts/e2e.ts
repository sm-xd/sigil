// pnpm e2e — run the consuming agent once against GATEWAY_URL; exit 1 unless a real x402 request settled via Blocky402.
// The license NFT makes every later run free (that is the point), so a repeat demo needs a payer with no license:
// E2E_FRESH_PAYER=1 creates a throwaway Hedera account (5 HBAR from the operator) and pays from it.
import { config } from "dotenv";
import { main } from "../packages/agent/src/index.ts";

config({ path: new URL("../.env", import.meta.url).pathname });

if (process.env.E2E_FRESH_PAYER === "1") {
  const { createAccount, hashscanUrl, transferToken } = await import("../packages/hedera/src/index.ts");
  const { usdcBalance } = await import("../packages/agent/src/pay.ts");
  const { accountId, privateKey } = await createAccount(5);
  console.log(`e2e: fresh payer ${accountId} (5 HBAR, no license yet) ${hashscanUrl("account", accountId)}`);
  // If the configured agent account holds testnet USDC, hand the fresh payer 2 USDC so the HTS USDC leg settles instead of HBAR.
  const usdc = process.env.HEDERA_USDC_TOKEN_ID ?? "0.0.429274";
  const mirror = process.env.HEDERA_MIRROR_URL ?? "https://testnet.mirrornode.hedera.com";
  const from = process.env.HEDERA_AGENT_ACCOUNT_ID, fromKey = process.env.HEDERA_AGENT_KEY;
  if (from && fromKey && (await usdcBalance(mirror, usdc, from)) >= 2_000_000n) {
    const txId = await transferToken(usdc, from, fromKey, accountId, 2_000_000);
    console.log(`e2e: fresh payer funded with 2 USDC (HTS ${usdc}) from ${from} ${hashscanUrl("transaction", txId)}`);
    await new Promise((r) => setTimeout(r, 4000)); // mirror-node lag before pay.ts reads the balance
  }
  process.env.HEDERA_AGENT_ACCOUNT_ID = accountId;
  process.env.HEDERA_AGENT_KEY = privateKey;
}

const t = await main(["--once"]);
if (t.paid === 0) {
  console.error("e2e: FAIL — no paid x402 request settled (needs HEDERA_AGENT_ACCOUNT_ID/KEY set and a skill the agent has not licensed yet; try E2E_FRESH_PAYER=1)");
  process.exit(1);
}
console.log(`e2e: OK — ${t.paid} paid request(s) settled, ${t.disputed} dispute(s) opened, ${t.resolved} resolved`);
process.exit(0); // the Hedera SDK client keeps gRPC channels open; nothing left to await
