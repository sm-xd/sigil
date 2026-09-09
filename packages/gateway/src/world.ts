// World ID (Selfie Check) verification. Mode is a labelled stub until sandbox access lands.
import { signRequest } from "@worldcoin/idkit-core/signing";
import { HttpError } from "./state.ts";

export const worldMode = (): string => process.env.WORLD_MODE ?? "mock";
const VERIFY_URL = "https://developer.world.org/api/v4/verify"; // from World's reference integration (see WORLD-NOTES.md)

/** Verify a proof and return its nullifier: the personhood reference stored on claims and disputes. */
export async function verifyWorldProof(proof: unknown): Promise<string> {
  const p = (proof && typeof proof === "object" ? proof : {}) as Record<string, unknown>;
  if (worldMode() === "mock") {
    if (p.mock !== true || typeof p.nullifier !== "string" || !/^0x[0-9a-fA-F]{2,64}$/.test(p.nullifier))
      throw new HttpError(400, "WORLD_MODE=mock: worldProof must be { mock: true, nullifier: '0x…' }");
    return p.nullifier.toLowerCase();
  }
  if (worldMode() !== "sandbox") throw new HttpError(500, `unknown WORLD_MODE ${worldMode()}`);
  if (p.mock) throw new HttpError(400, "mock proofs are rejected when WORLD_MODE=sandbox");
  // A headless agent cannot run IDKit. Its operator verifies once through the web and lists the resulting nullifier in
  // WORLD_PREVERIFIED_NULLIFIERS; the agent then presents { nullifier } and the both-sides rule applies to it as usual.
  if (typeof p.nullifier === "string" && !("responses" in p)) {
    const allowed = (process.env.WORLD_PREVERIFIED_NULLIFIERS ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (allowed.includes(p.nullifier.toLowerCase())) return p.nullifier.toLowerCase();
    throw new HttpError(400, "sandbox: a bare nullifier is accepted only when listed in WORLD_PREVERIFIED_NULLIFIERS (operator pre-verified through the web)");
  }
  const rpId = process.env.NEXT_PUBLIC_WORLD_RP_ID;
  if (!rpId) throw new HttpError(500, "NEXT_PUBLIC_WORLD_RP_ID not configured");
  // Forward the full IDKit v4 result as-is; World validates it server side.
  const res = await fetch(`${VERIFY_URL}/${rpId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p) });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new HttpError(400, err.detail ?? `World verification failed (${res.status})`);
  }
  // TODO(verify): the v4 verify response body is undocumented in the reference; the nullifier is read from
  // the IDKit result that World just validated (responses[0].nullifier).
  const nullifier = (p.responses as Array<{ nullifier?: string }> | undefined)?.[0]?.nullifier;
  if (typeof nullifier !== "string" || !nullifier) throw new HttpError(400, "IDKit result has no responses[0].nullifier");
  return nullifier.toLowerCase();
}

/** `rp_context` for IDKit.request(): an RP-signed nonce binding the proof to this relying party. */
export function rpContext(action: string) {
  const key = process.env.WORLD_RP_SIGNING_KEY;
  if (!key) throw new HttpError(500, "WORLD_RP_SIGNING_KEY not configured");
  const { sig, nonce, createdAt, expiresAt } = signRequest({ signingKeyHex: key, action });
  return { rp_id: process.env.NEXT_PUBLIC_WORLD_RP_ID ?? "", nonce, created_at: createdAt, expires_at: expiresAt, signature: sig };
}
