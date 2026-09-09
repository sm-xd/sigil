import type { AfterSettleHook, HTTPTransportContext, ProtectedRequestHook } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { inspectHederaTransaction } from "@x402/hedera";
import { holdsLicense, mintLicense } from "@sigil/hedera";
import { hcs, save, state, topicForSkill, type Payment } from "./state.ts";

export const ACCOUNT_HEADER = "x-hedera-account";
export const skillIdFromPath = (path: string): string => path.split("/")[2] ?? "";
const hashscanTx = (txId: string) => `https://hashscan.io/${process.env.HEDERA_NETWORK ?? "testnet"}/transaction/${txId}`;

// ponytail: header is unauthenticated; ownership is checked on mirror so the worst case is a
// licensee's free read being replayed; upgrade path: signed nonce.
export const licenseGate: ProtectedRequestHook = async (ctx) => {
  const account = ctx.adapter.getHeader(ACCOUNT_HEADER) ?? "";
  const tokenId = process.env.HEDERA_LICENSE_TOKEN_ID ?? "";
  if (!tokenId || !/^0\.0\.\d+$/.test(account)) return;
  const skillId = skillIdFromPath(ctx.path);
  try {
    if (await holdsLicense(tokenId, account, skillId)) {
      console.log(`[license] ${account} holds a license for ${skillId}: served free`);
      return { grantAccess: true };
    }
  } catch (e) {
    console.warn(`[license] holdsLicense failed, falling through to payment: ${(e as Error).message}`);
  }
};

/** After Blocky402 settles: HCS audit record, then mint the license NFT to the payer. Detached so the paid response is never delayed or failed by it. */
export const onSettled: AfterSettleHook = async (ctx) => {
  const transport = ctx.transportContext as HTTPTransportContext | undefined;
  const skillId = skillIdFromPath(transport?.request.path ?? "");
  const payer = ctx.result.payer || payerFromPayload(ctx.paymentPayload as PaymentPayload, ctx.requirements as PaymentRequirements);
  void afterSettlement(skillId, payer, ctx.result.transaction, ctx.requirements as PaymentRequirements, transport?.responseBody?.length ?? 0)
    .catch((e) => console.warn(`[settle] post-settlement side effect failed (non-fatal): ${(e as Error).message}`));
};

async function afterSettlement(skillId: string, payer: string, txId: string, req: PaymentRequirements, bytes: number): Promise<void> {
  console.log(`[settle] ${skillId} paid by ${payer || "?"}: ${req.amount} of ${req.asset} on ${req.network}, tx ${txId} ${hashscanTx(txId)}`);
  const { topicId, claimId } = topicForSkill(skillId);
  await hcs(topicId, "PAYMENT_SETTLED", claimId, { skillId, payer, amount: req.amount, asset: req.asset, network: req.network, txId, bytes });
  const record: Payment = { skillId, payer, amount: req.amount, asset: req.asset, network: req.network, txId, bytes, ts: Date.now() };
  state.payments.push(record);
  save();
  const tokenId = process.env.HEDERA_LICENSE_TOKEN_ID ?? "";
  if (!tokenId || !payer) { console.warn(`[license] mint skipped (tokenId=${tokenId || "unset"}, payer=${payer || "unknown"})`); return; }
  const { serial, txId: mintTx } = await mintLicense(tokenId, payer, skillId);
  console.log(`[license] minted ${tokenId}#${serial} to ${payer} ${hashscanTx(mintTx)}`);
  record.licenseSerial = serial;
  save();
  await hcs(topicId, "LICENSE_MINTED", claimId, { skillId, to: payer, tokenId, serial });
}

/** Fallback when the facilitator omits `payer`: the account debited for the required asset in the signed transaction. */
function payerFromPayload(payload: PaymentPayload, req: PaymentRequirements): string {
  try {
    const tx = inspectHederaTransaction(String(payload.payload.transaction));
    const transfers = req.asset === "0.0.0" ? tx.hbarTransfers : (tx.tokenTransfers[req.asset] ?? []);
    return transfers.find((t) => BigInt(t.amount) < 0n)?.accountId ?? "";
  } catch {
    return "";
  }
}
