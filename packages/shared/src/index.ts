// @sigil/shared — the one vocabulary every package codes against. Keep it small.
import { createHash } from "node:crypto";

// ── Predicates: exactly three. Do not add a fourth. ──────────────────────────
export type PredicateKind =
  | "NO_ENV_READ_OUTSIDE" // reads no env var outside the allowlist
  | "NO_NET_EGRESS_OUTSIDE" // opens no connection to a host outside the allowlist
  | "NO_FS_READ_OUTSIDE" // reads no path outside the allowlist
  | "NO_FS_WRITE_OUTSIDE" // writes no path outside the allowlist
  | "NO_CHILD_PROCESS" // starts no subprocess or worker (no allowlist: the sandbox never lets one run, the claim is that the skill never tries)
  | "NO_DYNAMIC_CODE"; // no eval, new Function or vm (no allowlist, same reason)
export const PREDICATE_KINDS: readonly PredicateKind[] = ["NO_ENV_READ_OUTSIDE", "NO_NET_EGRESS_OUTSIDE", "NO_FS_READ_OUTSIDE", "NO_FS_WRITE_OUTSIDE", "NO_CHILD_PROCESS", "NO_DYNAMIC_CODE"];
export const NO_ALLOWLIST_KINDS: ReadonlySet<PredicateKind> = new Set<PredicateKind>(["NO_CHILD_PROCESS", "NO_DYNAMIC_CODE"]);

export interface Predicate {
  kind: PredicateKind;
  allowlist: string[]; // env names | hostnames | path globs
}

// ── Core entities ────────────────────────────────────────────────────────────
export interface SkillManifest {
  entrypoint: string;
  declaredEnv: string[];
  declaredHosts: string[];
}

export interface Skill {
  id: string; // sha256 of the source bundle
  name: string;
  sourceUri: string; // HCS-1 pointer (hcs://1/<topicId>) or IPFS CID
  manifest: SkillManifest;
  author: string;
  registeredAt: number;
  description?: string; // one line for the registry; skill.json `description`
}

export type ClaimStatus = "LIVE" | "DISPUTED" | "BROKEN" | "UPHELD";

export interface Claim {
  id: string; // bytes32 hex, same value used on Arc
  skillId: string;
  predicate: Predicate;
  stakeAmount: string; // USDC base units, 6dp
  stakedBy: string; // Arc address
  humanProofRef: string; // Selfie Check nullifier reference
  status: ClaimStatus;
  arcEscrowId: string; // SigilStake address
  arcTxHash: string; // openClaim tx on Arc; "" for a claim recorded without escrow (off-chain record)
  hcsTopicId: string; // per-claim topic
  createdAt: number;
}

export type DisputeStatus = "OPEN" | "SUSTAINED" | "REJECTED";

export interface Dispute {
  id: string;
  claimId: string;
  by: string; // Arc address
  counterBond: string; // USDC base units
  evidenceUri: string; // HCS-1 pointer to the trace bundle
  traceHash: string; // sha256 of canonical trace
  status: DisputeStatus;
  arcTxHash: string; // dispute tx on Arc; "" when the counter-bond is an off-chain record
  humanProofRef: string;
  createdAt: number;
}

export type Outcome = "CLAIM_BROKEN" | "CLAIM_UPHELD";

export interface Resolution {
  claimId: string;
  disputeId: string | null;
  outcome: Outcome;
  winner: string;
  reason: string;
  arcTxHash: string;
  hcsSequence: number;
}

// ── Sandbox trace ────────────────────────────────────────────────────────────
export type TraceEventKind = "env" | "fs" | "net" | "fswrite" | "proc" | "code";

export interface TraceEvent {
  seq: number;
  kind: TraceEventKind;
  target: string; // env var name | relative path | host:port
  stack: string[]; // relative frames only, no absolute paths
}

export interface TraceBundle {
  v: 1;
  skillId: string;
  predicate: Predicate;
  runtime: { node: string; image: string; shim: number }; // pinned so re-runs match; shim = the sandbox interposition version, bumped whenever the shim changes what it records
  input: { argv: string[]; stdin: string };
  events: TraceEvent[];
  violations: TraceEvent[]; // subset of events that break the predicate
  traceHash: string; // traceHashOf(bundle)
}

/** The canonical, hash-covered part of a bundle. Everything else is metadata. */
export function traceHashOf(b: Omit<TraceBundle, "traceHash" | "violations">): string {
  const { v, skillId, predicate, runtime, input, events } = b;
  return sha256Hex(canonicalize({ v, skillId, predicate, runtime, input, events }));
}

// ── HCS messages: every message on every topic has this envelope ─────────────
export type HcsMessageType =
  | "SKILL_REGISTERED"
  | "CLAIM_OPENED"
  | "EVIDENCE_SUBMITTED"
  | "DISPUTE_OPENED"
  | "RESOLVED"
  | "PAYMENT_SETTLED"
  | "LICENSE_MINTED"
  | "IDENTITY";

export interface HcsMessage<T = unknown> {
  v: 1;
  type: HcsMessageType;
  claimId: string; // "" for skill-level messages
  payload: T;
  ts: number;
}

export function hcsMessage<T>(type: HcsMessageType, claimId: string, payload: T): HcsMessage<T> {
  return { v: 1, type, claimId, payload, ts: Date.now() };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
/** Sorted keys, undefined dropped, arrays ordered, JSON number formatting. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = sortDeep(x);
    }
    return out;
  }
  return v;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export const USDC_DECIMALS = 6;
/** "12.5" -> 12500000n */
export function usdcToBase(amount: string | number): bigint {
  const [i, f = ""] = String(amount).split(".");
  return BigInt(i) * 10n ** 6n + BigInt((f + "000000").slice(0, 6));
}
export function baseToUsdc(base: bigint | string): string {
  const b = BigInt(base);
  return `${b / 1_000_000n}.${(b % 1_000_000n).toString().padStart(6, "0")}`;
}

/** bytes32 claim id — identical on Arc, Hedera and in the gateway. */
export function claimIdOf(skillId: string, predicate: Predicate, stakedBy: string, nonce: string): `0x${string}` {
  return `0x${sha256Hex(canonicalize({ skillId, predicate, stakedBy: stakedBy.toLowerCase(), nonce }))}`;
}

export const OUTCOME_REASON: Record<Outcome, string> = {
  CLAIM_BROKEN: "CLAIM_BROKEN",
  CLAIM_UPHELD: "CLAIM_UPHELD",
};

// ── Skill source as materialised for the sandbox ─────────────────────────────
/** files: relative path -> utf8 content. entrypoint must be a key of files. */
export interface SkillSource {
  entrypoint: string;
  files: Record<string, string>;
}
/** The inputs every probe runs (agent and the gateway's /probe). Error handlers are where secrets leak: the malformed input walks the skill into them. */
export const PROBE_INPUTS: { label: string; input: { argv: string[]; stdin: string } }[] = [
  { label: "benign", input: { argv: ['{"bucket":"demo","files":["index.html"]}'], stdin: '{"query":"hello"}' } }, // a well-formed config on both argv and stdin
  { label: "malformed (error path)", input: { argv: ["--not-a-flag"], stdin: "{not json" } },
];
/** Skill.id = sha256 of the canonical source. */
export function skillIdOf(source: SkillSource): string {
  return sha256Hex(canonicalize(source));
}
