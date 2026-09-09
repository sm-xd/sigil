// Discovery + the decision policy. `decide` is pure so its reasoning is testable and printable.
import type { Claim, Dispute, Resolution, Skill } from "@sigil/shared";
import { baseToUsdc, usdcToBase } from "@sigil/shared";

export type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** CONTRACT — ARCHITECTURE.md, `GET /skills`. */
export interface SkillSummary extends Skill {
  totalStaked: string; // USDC base units, LIVE + DISPUTED claims
  totalEscrowed?: string; // the part of totalStaked with an openClaim tx on Arc
  liveClaims: number;
  disputes: number;
  sustainedDisputes: number;
  oldestClaimAgeSec: number | null;
}

/** CONTRACT — ARCHITECTURE.md, `GET /skills/:id`. */
export interface SkillDetail {
  skill: Skill;
  claims: Claim[];
  disputes: Dispute[];
  resolutions: Resolution[];
  license: { tokenId: string };
}

export interface Policy {
  minStakeUsdc: number;
  minClaimAgeSec: number;
  maxSustainedDisputes: number;
}

export function policyFromEnv(env: NodeJS.ProcessEnv = process.env): Policy {
  return {
    minStakeUsdc: Number(env.POLICY_MIN_STAKE_USDC ?? 50),
    minClaimAgeSec: Number(env.POLICY_MIN_CLAIM_AGE_SEC ?? 60),
    maxSustainedDisputes: Number(env.POLICY_MAX_SUSTAINED_DISPUTES ?? 0),
  };
}

export function describePolicy(p: Policy, onChainOnly = false): string {
  return `install iff ${onChainOnly ? "escrowedOnArc" : "totalStaked"} ≥ ${p.minStakeUsdc} USDC ∧ oldestClaimAge ≥ ${p.minClaimAgeSec}s ∧ sustainedDisputes ≤ ${p.maxSustainedDisputes}`;
}

/** Every check is evaluated (no short-circuit) so the printed reasoning is complete. */
/** onChainOnly: with a stake contract configured, only capital that has an openClaim tx on Arc counts. */
export function decide(s: SkillSummary, p: Policy, onChainOnly = false): { install: boolean; reasons: string[] } {
  const staked = BigInt((onChainOnly ? s.totalEscrowed : s.totalStaked) || "0");
  const label = onChainOnly ? "escrowedOnArc" : "totalStaked";
  if (s.liveClaims === 0 || staked === 0n || s.oldestClaimAgeSec == null) {
    return { install: false, reasons: [onChainOnly && BigInt(s.totalStaked || "0") > 0n ? "no capital escrowed on Arc (off-chain records only) → skip" : "unstaked → skip"] };
  }
  const min = usdcToBase(p.minStakeUsdc);
  const checks: [boolean, string][] = [
    [staked >= min, `${label} ${baseToUsdc(staked)} ${staked >= min ? "≥" : "<"} ${p.minStakeUsdc}`],
    [s.oldestClaimAgeSec >= p.minClaimAgeSec, `oldestClaimAge ${s.oldestClaimAgeSec}s ${s.oldestClaimAgeSec >= p.minClaimAgeSec ? "≥" : "<"} ${p.minClaimAgeSec}s`],
    [s.sustainedDisputes <= p.maxSustainedDisputes, `sustainedDisputes ${s.sustainedDisputes} ${s.sustainedDisputes <= p.maxSustainedDisputes ? "≤" : ">"} ${p.maxSustainedDisputes}`],
  ];
  return {
    install: checks.every(([ok]) => ok),
    reasons: checks.map(([ok, text]) => `${text} ${ok ? "✓" : "✗ → skip"}`),
  };
}

async function getJson<T>(f: Fetch, url: string): Promise<T> {
  const res = await f(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export async function listSkills(gateway: string, f: Fetch = fetch): Promise<SkillSummary[]> {
  return (await getJson<{ skills: SkillSummary[] }>(f, `${gateway}/skills`)).skills;
}

export async function getSkill(gateway: string, id: string, f: Fetch = fetch): Promise<SkillDetail> {
  return getJson<SkillDetail>(f, `${gateway}/skills/${id}`);
}
