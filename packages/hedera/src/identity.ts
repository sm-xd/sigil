import { createHash } from "node:crypto";
import { NETWORK } from "./client.ts";

/** Base58 (Bitcoin alphabet) — HCS-14 §Implementation Requirements 3: "The resulting hash shall be encoded using Base58." */
function base58(bytes: Buffer): string {
  let n = BigInt(`0x${bytes.toString("hex")}`);
  let out = "";
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  while (n > 0n) {
    out = A[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/**
 * HCS-14 universal agent id, `uaid:aid` target: Sigil has no resolvable W3C DID, and the spec's
 * method selection says to use `aid` when "Agents don't have existing W3C DIDs".
 *
 * id = Base58(SHA-384(canonical JSON of the six canonical fields)); registry/protocol lowercased,
 * strings trimmed, skills sorted ascending. Key order is the one in the standard's own Test Vector 1
 * (`skills` first, then lexicographic) and in the reference SDK (`standards-sdk/src/hcs-14/canonical.ts`),
 * not the "sorted keys" prose in §Hash Generation step 3 — those two disagree in the draft and the
 * vectors/SDK are what other implementations actually hash. TODO(verify) once the draft settles.
 * Params are `uid;registry;proto;nativeId`: "Implementations shall preserve this order when emitting UAIDs."
 *
 * The canonical record is Sigil's own, not per-account: accounts stay distinct through `nativeId`
 * ("uniqueness is anchored by nativeId ... and registry"). proto=rest because the gateway is an HTTP
 * JSON/x402 service — Sigil operates no HCS-10 inbound/outbound topics. skills are the two enums Sigil
 * actually provides: 33 Blockchain Integration, 39 Trust Attestation. Any edit below mints a new AID
 * ("Any change to the six canonical fields shall result in a new AID") — see README before touching it.
 */
export function buildUaid(accountId: string, opts: { network?: "testnet" | "mainnet"; uid?: string } = {}): string {
  const nativeId = `hedera:${opts.network ?? NETWORK}:${accountId}`;
  const canonical = JSON.stringify({ skills: [33, 39], name: "Sigil Gateway", nativeId, protocol: "rest", registry: "sigil", version: "0.1.0" });
  const id = base58(createHash("sha384").update(canonical, "utf8").digest());
  return `uaid:aid:${id};uid=${opts.uid ?? accountId};registry=sigil;proto=rest;nativeId=${nativeId}`;
}
