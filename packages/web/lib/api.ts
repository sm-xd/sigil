// Gateway HTTP client. Shapes mirror packages/gateway/src/server.ts (the truth) and ARCHITECTURE.md CONTRACT.
import type { Claim, Dispute, Predicate, Resolution, Skill, SkillManifest, SkillSource, TraceBundle } from "@sigil/shared"; // Claim/Dispute carry arcTxHash ("" = off-chain record)

export interface SkillSummary extends Skill {
  totalStaked: string; // USDC base units, LIVE + DISPUTED claims (every recorded claim)
  totalEscrowed: string; // the part of totalStaked with an openClaim tx on Arc; the rest are off-chain records with no stake on the contract
  paidRequests: number; // x402 settlements this gateway index served for the skill
  liveClaims: number;
  disputes: number;
  sustainedDisputes: number;
  oldestClaimAgeSec: number | null;
}
export interface SkillDetail { skill: Skill; claims: Claim[]; disputes: Dispute[]; resolutions: Resolution[]; license: { tokenId: string } }
export interface Health { ok: boolean; network: string; worldMode: string; registryTopicId: string; licenseTokenId: string; stakeAddress: string }
/** One x402 leg the paywall accepts. asset 0.0.0 is HBAR in tinybar; anything else is the HTS USDC token in 6-dp base units. */
export interface AccessLeg { scheme: string; network: string; payTo: string; asset: string; amount: string }
export interface Payment { skillId: string; payer: string; amount: string; asset: string; network: string; txId: string; bytes: number; ts: number; licenseSerial?: number }
export interface Access {
  skillId: string;
  price: { bytes: number; kb: number; perKbUsdc: string; accepts: AccessLeg[] };
  payTo: string; network: string; facilitator: string; licenseToken: string;
  licences: { serial: number; account: string }[]; // from the mirror node; survive gateway restarts
  payments: Payment[]; // this index's settlements, newest first
  howTo: { buy: string; agent: string; curl: string };
}
export interface Paywall { error: string; bytes: number; kb: number; accepts: AccessLeg[] }
export interface RpContext { rp_id: string; nonce: string; created_at: number; expires_at: number; signature: string }
export type WorldProof = { mock: true; nullifier: string } | Record<string, unknown>;

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Same-origin prefix rewritten to NEXT_PUBLIC_GATEWAY_URL by next.config.ts. The gateway does send CORS headers (Access-Control-Allow-Origin: *, x402 headers exposed); the rewrite is kept as a convenience. */
const BASE = "/gw";

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, json.error ?? `${res.status} ${res.statusText}`);
  return json;
}

export const getHealth = () => call<Health>("/health");
export const getSkills = () => call<{ skills: SkillSummary[] }>("/skills").then((r) => r.skills);
export const getSkill = (id: string) => call<SkillDetail>(`/skills/${id}`);
export const getAccess = (id: string) => call<Access>(`/skills/${id}/access`);
/** GET /source with no licence header and no payment: the 402 with its accepts legs is the paywall an agent sees. 200 only for a licence holder. */
export async function requestSource(id: string): Promise<{ status: 402; paywall: Paywall } | { status: 200; bytes: number }> {
  const res = await fetch(`${BASE}/skills/${id}/source`);
  const text = await res.text();
  if (res.status === 402) return { status: 402, paywall: JSON.parse(text) as Paywall };
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText}`);
  return { status: 200, bytes: new Blob([text]).size };
}
/** Register a skill. The gateway hashes the canonical source into the id, so re-posting the same files is a 200 with the same skill. */
export async function postSkill(b: { name: string; author: string; manifest: SkillManifest; source: SkillSource }): Promise<{ skill: Skill; created: boolean }> {
  const res = await fetch(`${BASE}/skills`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
  const json = (await res.json().catch(() => ({}))) as Skill & { error?: string };
  if (!res.ok) throw new ApiError(res.status, json.error ?? `${res.status} ${res.statusText}`);
  return { skill: json, created: res.status === 201 };
}
export const postClaim = (b: { skillId: string; predicate: Predicate; stakeAmount: string; stakedBy: string; arcTxHash: string; worldProof: WorldProof; nonce: string }) => call<Claim>("/claims", b);
export const postDispute = (claimId: string, b: { by: string; counterBond: string; traceBundle: TraceBundle; arcTxHash: string; worldProof: WorldProof }) => call<Dispute>(`/claims/${claimId}/dispute`, b);
export const postResolve = (claimId: string) => call<{ reproduced: boolean; observedHash: string; verdictTxHash: string }>(`/claims/${claimId}/resolve`, {});
export const postResolved = (claimId: string, arcTxHash: string) => call<Resolution>(`/claims/${claimId}/resolved`, { arcTxHash });
export const postRpContext = (action: string) => call<RpContext>("/world/rp-context", { action });

/** Locate a claim by id: straight to the skill when known, else scan every skill (six in the demo). */
export async function findClaim(claimId: string, skillId?: string | null): Promise<{ detail: SkillDetail; claim: Claim } | null> {
  const ids = skillId ? [skillId] : (await getSkills()).map((s) => s.id);
  for (const detail of await Promise.all(ids.map(getSkill))) {
    const claim = detail.claims.find((c) => c.id === claimId);
    if (claim) return { detail, claim };
  }
  return null;
}
