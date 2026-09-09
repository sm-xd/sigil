// x402 payment on Hedera testnet, settled by the Blocky402 facilitator.
// Mirrors hedera-dev/x402-inference-pay-per-request-poc (packages/agent/src/x402-client.ts):
// the client signs a *partially signed* Hedera transaction; the facilitator pays gas and submits it.
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactHederaScheme, PrivateKey, createClientHederaSigner } from "@x402/hedera";
import type { SkillManifest, SkillSource } from "@sigil/shared";
import type { Fetch } from "./discover.ts";

export interface Payer {
  accountId: string; // Hedera account that pays and receives the license NFT
  fetch: Fetch; // 402 → sign → retry, transparently
}

export interface Settlement {
  transaction: string; // Hedera transaction id as reported by the facilitator
  network: string;
  payer?: string;
  amount?: string;
}

export const hashscan = (txId: string) => `https://hashscan.io/testnet/transaction/${txId}`;

/** null when HEDERA_AGENT_ACCOUNT_ID / HEDERA_AGENT_KEY are not configured (bootstrap not run yet). */
export function payerFromEnv(env: NodeJS.ProcessEnv = process.env, log: (s: string) => void = console.log): Payer | null {
  const accountId = env.HEDERA_AGENT_ACCOUNT_ID;
  const key = env.HEDERA_AGENT_KEY;
  if (!accountId || !key) return null;
  const signer = createClientHederaSigner(accountId, PrivateKey.fromStringECDSA(key), { network: "hedera:testnet" });
  const usdc = env.HEDERA_USDC_TOKEN_ID ?? "0.0.429274";
  const mirror = env.HEDERA_MIRROR_URL ?? "https://testnet.mirrornode.hedera.com";
  // The gateway offers two legs: USDC (HTS) and HBAR. Pay USDC when the agent holds any, else HBAR.
  // Resolved once, on the first 402, so the (sync) policy below has the answer when it runs.
  let hasUsdc: boolean | null = null;
  const client = new x402Client()
    .register("hedera:testnet", new ExactHederaScheme(signer))
    .setSpendControls({ allowedAssets: [{ network: "hedera:testnet", asset: "0.0.0" }, { network: "hedera:testnet", asset: usdc }] }) // HBAR is not a client "default asset"
    .registerPolicy((_v, reqs) => {
      const want = hasUsdc ? usdc : "0.0.0";
      const picked = reqs.filter((r) => r.asset === want);
      log(hasUsdc ? `  x402: paying the USDC leg (HTS ${usdc})` : "  x402: paying the HBAR leg — agent holds no testnet USDC (faucet.circle.com → Hedera Testnet)");
      return picked.length ? picked : reqs;
    });
  const traced: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    if (req.headers.has("PAYMENT-SIGNATURE")) log("  x402: signed → retrying with PAYMENT-SIGNATURE (Blocky402 submits, pays gas)");
    const res = await globalThis.fetch(req);
    if (res.status === 402) {
      log("  x402: 402 Payment Required → signing partial Hedera tx");
      if (hasUsdc === null) hasUsdc = (await usdcBalance(mirror, usdc, accountId)) > 0n;
    }
    return res;
  };
  return { accountId, fetch: wrapFetchWithPayment(traced, client) };
}

/** GET /skills/:id/source. `settlement` is null when the gateway served it free (license NFT already held). */
export async function fetchSource(gateway: string, skillId: string, payer: Payer | null) {
  const res = await (payer?.fetch ?? fetch)(`${gateway}/skills/${skillId}/source`, {
    headers: { "X-Hedera-Account": payer?.accountId ?? "" },
  });
  if (!res.ok) throw new Error(`GET /skills/${skillId}/source → ${res.status} ${await res.text()}`);
  const header = res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");
  const settlement: Settlement | null = header ? decodePaymentResponseHeader(header) : null;
  const body = (await res.json()) as { skillId: string; source: SkillSource; manifest: SkillManifest };
  return { body, settlement };
}

/** Mirror-node check that the payer now holds the HTS license NFT. Polls briefly for mirror lag. */
export async function holdsLicense(mirror: string, tokenId: string, accountId: string, attempts = 5): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(`${mirror}/api/v1/tokens/${tokenId}/nfts?account.id=${accountId}&limit=1`);
    if (res.ok && ((await res.json()) as { nfts?: unknown[] }).nfts?.length) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

/** Mirror-node HTS balance of `tokenId` for `accountId` (0n when unassociated or on error). */
export async function usdcBalance(mirror: string, tokenId: string, accountId: string): Promise<bigint> {
  try {
    const res = await fetch(`${mirror}/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}`);
    const body = (await res.json()) as { tokens?: { balance: number }[] };
    return BigInt(body.tokens?.[0]?.balance ?? 0);
  } catch {
    return 0n;
  }
}
