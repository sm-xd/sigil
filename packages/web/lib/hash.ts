// Browser-safe twins of @sigil/shared's claimIdOf / traceHashOf. @sigil/shared imports node:crypto at module top,
// so client components import only TYPES from it and hash here. canonicalize is copied verbatim; sha256 comes from
// viem (sync, @noble/hashes) — byte-identical to createHash("sha256"). Checked by scripts in the parent report.
import { sha256, stringToBytes } from "viem";
import type { Predicate, PredicateKind, SkillSource, TraceBundle } from "@sigil/shared";

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

export const sha256Hex = (s: string): string => sha256(stringToBytes(s)).slice(2);

/** Skill.id = sha256 of the canonical source, the same derivation as the gateway. */
export const skillIdOf = (source: SkillSource): string => sha256Hex(canonicalize(source));

export function claimIdOf(skillId: string, predicate: Predicate, stakedBy: string, nonce: string): `0x${string}` {
  return `0x${sha256Hex(canonicalize({ skillId, predicate, stakedBy: stakedBy.toLowerCase(), nonce }))}`;
}

export function traceHashOf(b: Omit<TraceBundle, "traceHash" | "violations">): string {
  const { v, skillId, predicate, runtime, input, events } = b;
  return sha256Hex(canonicalize({ v, skillId, predicate, runtime, input, events }));
}

const KINDS = ["NO_ENV_READ_OUTSIDE", "NO_NET_EGRESS_OUTSIDE", "NO_FS_READ_OUTSIDE", "NO_FS_WRITE_OUTSIDE", "NO_CHILD_PROCESS", "NO_DYNAMIC_CODE"] as const satisfies readonly PredicateKind[];
type _AllKindsListed = Exclude<PredicateKind, (typeof KINDS)[number]> extends never ? true : "a PredicateKind is missing from KINDS"; const _kindsComplete: _AllKindsListed = true; void _kindsComplete;

/** Shape check for a pasted/uploaded bundle. Returns an error string or null. */
export function validateBundle(x: unknown): string | null {
  const b = x as TraceBundle;
  if (!b || typeof b !== "object") return "not an object";
  if (b.v !== 1) return "v must be 1";
  if (typeof b.skillId !== "string" || !b.skillId) return "skillId missing";
  if (!b.predicate || !KINDS.includes(b.predicate.kind) || !Array.isArray(b.predicate.allowlist)) return "predicate.kind / allowlist invalid";
  if (!b.runtime || typeof b.runtime.node !== "string" || typeof b.runtime.image !== "string" || typeof b.runtime.shim !== "number") return "runtime.node / runtime.image / runtime.shim missing";
  if (!b.input || !Array.isArray(b.input.argv) || typeof b.input.stdin !== "string") return "input.argv / input.stdin missing";
  if (!Array.isArray(b.events) || !Array.isArray(b.violations)) return "events / violations must be arrays";
  for (const e of [...b.events, ...b.violations])
    if (typeof e.seq !== "number" || !["env", "fs", "net"].includes(e.kind) || typeof e.target !== "string" || !Array.isArray(e.stack)) return "event shape invalid";
  if (typeof b.traceHash !== "string" || !/^[0-9a-f]{64}$/.test(b.traceHash)) return "traceHash must be 64 hex chars";
  return null;
}
