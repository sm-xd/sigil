// ponytail: JSON file packages/gateway/data/state.json is the index; HCS is the audit log;
// rebuild-from-HCS not implemented, add when the index is lost.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { hcsMessage, type Claim, type Dispute, type HcsMessageType, type Resolution, type Skill, type SkillSource, type TraceBundle } from "@sigil/shared";
import { submitMessage } from "@sigil/hedera";

export interface StoredSkill extends Skill { source: SkillSource }
export interface StoredDispute extends Dispute { traceBundle: TraceBundle }
export interface Verdict { reproduced: boolean; observedHash: string; verdictTxHash: string }
export interface State {
  skills: Record<string, StoredSkill>;
  claims: Record<string, Claim>;
  disputes: Record<string, StoredDispute>;
  resolutions: Resolution[];
  verdicts: Record<string, Verdict>; // claimId -> last verifier verdict (what was posted to the resolver)
  payments: Payment[]; // every x402 settlement the gateway served, newest last (the consumption ledger)
}

export interface Payment {
  skillId: string; payer: string; amount: string; asset: string; network: string; txId: string; bytes: number; ts: number;
  licenseSerial?: number; // set once the license NFT is minted to the payer
}

const FILE = process.env.GATEWAY_STATE_FILE ?? fileURLToPath(new URL("../data/state.json", import.meta.url));
const EMPTY: State = { skills: {}, claims: {}, disputes: {}, resolutions: [], verdicts: {}, payments: [] };
export const state: State = existsSync(FILE) ? { ...EMPTY, ...JSON.parse(readFileSync(FILE, "utf8")) } : EMPTY;
state.payments ??= []; // indexes written before the consumption ledger existed

export function save(): void {
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(state, null, 2));
}

/** Thrown by handlers; the express error handler maps it to `{ error }` with this status. */
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const registryTopic = (): string => process.env.HEDERA_REGISTRY_TOPIC_ID ?? "";

/** Claim topic of the skill's first claim that has one, else the registry topic (contract: PAYMENT_SETTLED / LICENSE_MINTED). */
export function topicForSkill(skillId: string): { topicId: string; claimId: string } {
  const claim = Object.values(state.claims).find((c) => c.skillId === skillId && c.hcsTopicId);
  return claim ? { topicId: claim.hcsTopicId, claimId: claim.id } : { topicId: registryTopic(), claimId: "" };
}

/** Submit an envelope to HCS. Never throws (hedera may be unconfigured or stubbed); returns the sequence number or 0. */
export async function hcs(topicId: string, type: HcsMessageType, claimId: string, payload: unknown): Promise<number> {
  if (!topicId) { console.warn(`[hcs] skip ${type}: no topic id configured`); return 0; }
  try {
    const { sequenceNumber, txId } = await submitMessage(topicId, hcsMessage(type, claimId, payload));
    console.log(`[hcs] ${type} -> topic ${topicId} seq ${sequenceNumber} tx ${txId}`);
    return sequenceNumber;
  } catch (e) {
    console.warn(`[hcs] ${type} -> topic ${topicId} failed (non-fatal): ${(e as Error).message}`);
    return 0;
  }
}
