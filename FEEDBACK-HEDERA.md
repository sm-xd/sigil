# Hedera integration feedback (x402 via Blocky402, HCS, HTS, HCS-14)

What Sigil used: `@x402/core`, `@x402/express`, `@x402/fetch` and `@x402/hedera` (exact scheme) with the Blocky402
facilitator on testnet; `@hashgraph/sdk` for HCS topics, HCS-1 file pins, an HTS licence NFT and mirror-node reads;
HCS-14 for the agent's identity. Each item: the sentence, what we expected, the fix we propose.

1. **Blocky402 is intermittently unreachable.** The facilitator sometimes answers a bare `402` with an empty body, or
   the connection fails outright, and a retry a minute later succeeds. Expected: a status page or a `Retry-After`.
   Fix: publish availability, and return a JSON error body on the facilitator's own failures so a client can tell
   "pay me" from "I am down".
2. **The testnet USDC faucet drip never arrives until the account is associated with the token.** Nothing in the
   faucet says so; the transfer silently fails. Expected: the faucet associates on the recipient's behalf, or says
   "associate 0.0.429274 first". Fix: one sentence in the faucet UI, and an `association missing` error on the drip.
3. **Mirror-node lag right after settlement.** A balance or NFT read immediately after a settled payment can still
   show the old state, so "did the payment land" checks are racy. Expected: guidance on the lag and an idempotent
   way to wait. Fix: document the typical delay and give the record's consensus timestamp in the settlement response.
4. **The SDK keeps the process alive.** After the last call a script does not exit; every CLI needs an explicit
   `process.exit`. Expected: `client.close()` to release everything. Fix: make `close()` sufficient, or document the
   exit.
5. **x402 v2 header names.** The paywall arrives as a base64 `payment-required` header and the settlement as
   `payment-response` / `x-payment-response`; browsers only see them if the server exposes them with CORS. Expected:
   the x402 server package to set `Access-Control-Expose-Headers` for its own headers. Fix: do it in
   `paymentMiddlewareFromHTTPServer`, or say in the docs that a browser client needs it.
6. **The harness and plain API servers.** The Hedera Harness's SMOKE stage waited for a `Local:` log line that only
   Next and Vite print, and its preflight never parsed the recipe's validator files, so a typo cost a paid generator
   session. Both fixed and opened as [hedera-harness#75](https://github.com/hedera-dev/hedera-harness/pull/75) and
   [#76](https://github.com/hedera-dev/hedera-harness/pull/76).

What worked well: HCS-1 and HCS-14 were implementable from the specs alone, with a hand-computed `uaid:aid` vector
matching; `ExactHederaScheme` on the client side signs a partial transaction and the facilitator pays the fee, which is
exactly the "no API key, no subscription" property the track asks for; testnet finality made every claim event
readable on HashScan within seconds.
