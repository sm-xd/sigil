// x402 resource server settled through Blocky402 (mirrors hedera-dev/x402-inference-pay-per-request-poc).
import { HTTPFacilitatorClient, x402HTTPResourceServer, x402ResourceServer, type HTTPRequestContext, type RoutesConfig } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { paymentMiddlewareFromHTTPServer } from "@x402/express";
import { canonicalize, usdcToBase } from "@sigil/shared";
import { facilitatorUrl, x402Network } from "./blocky402.ts";
import { licenseGate, onSettled, skillIdFromPath } from "./license-gate.ts";
import { state, type StoredSkill } from "./state.ts";

export const SOURCE_ROUTE = "GET /skills/:id/source";
export const sourceBytes = (skill: StoredSkill): number => Buffer.byteLength(canonicalize(skill.source));

/** Per-call metering: ceil(bytes/1024) * PRICE_PER_KB_USDC, with a second leg in HBAR. */
export function priceFor(bytes: number) {
  const kb = Math.max(1, Math.ceil(bytes / 1024));
  const usdc = usdcToBase(process.env.PRICE_PER_KB_USDC ?? "0.001") * BigInt(kb);
  const leg = { scheme: "exact", network: x402Network(), payTo: process.env.HEDERA_OPERATOR_ID ?? "" };
  // ponytail: HBAR leg = USDC micro-units x 100 tinybars (0.001 USDC ≙ 0.001 HBAR, the POC's numbers), no oracle.
  // It exists so a payer with no testnet USDC can settle today; delete it when USDC is the only leg you want.
  return {
    bytes, kb,
    accepts: [
      { ...leg, asset: process.env.HEDERA_USDC_TOKEN_ID ?? "0.0.429274", amount: usdc.toString() },
      { ...leg, asset: "0.0.0", amount: (usdc * 100n).toString() },
    ],
  };
}

const bytesOf = (ctx: HTTPRequestContext): number => {
  const skill = state.skills[skillIdFromPath(ctx.path)];
  return skill ? sourceBytes(skill) : 0;
};

export function x402Middleware() {
  const network = x402Network() as Network;
  const payTo = process.env.HEDERA_OPERATOR_ID ?? "";
  if (!payTo) throw new Error("HEDERA_OPERATOR_ID (x402 payTo) is required");
  const leg = (i: 0 | 1) => ({
    scheme: "exact", network, payTo,
    price: (ctx: HTTPRequestContext) => { const { asset, amount } = priceFor(bytesOf(ctx)).accepts[i]; return { asset, amount }; },
  });
  const routes: RoutesConfig = {
    [SOURCE_ROUTE]: {
      accepts: [leg(0), leg(1)],
      description: "Sigil skill source bundle, metered per KB; pays for a license NFT",
      mimeType: "application/json",
      // v2 puts the requirements in the PAYMENT-REQUIRED header; the body mirrors them for humans and curl.
      unpaidResponseBody: (ctx) => ({ contentType: "application/json", body: { error: "Payment required", ...priceFor(bytesOf(ctx)) } }),
      settlementFailedResponseBody: (_ctx, r) => ({ contentType: "application/json", body: { error: "Settlement failed", reason: r.errorReason, message: r.errorMessage } }),
    },
  };
  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl() }))
    .register(network, new ExactHederaScheme())
    .onAfterSettle(onSettled);
  return paymentMiddlewareFromHTTPServer(new x402HTTPResourceServer(server, routes).onProtectedRequest(licenseGate));
}
