// Bundle assembly: the hash-covered part is exactly what traceHashOf reads.
import { traceHashOf, type Predicate, type TraceBundle, type TraceEvent } from "@sigil/shared";
import { evaluatePredicate } from "./predicates.ts";

export const SANDBOX_IMAGE = "sigil-sandbox:node22"; // pinned in every bundle
// ponytail: image tag recorded, docker exec not wired; add when re-runs must be cross-machine-identical beyond Node version.

export function makeBundle(skillId: string, predicate: Predicate, node: string, input: TraceBundle["input"], events: TraceEvent[]): TraceBundle {
  const base = { v: 1 as const, skillId, predicate, runtime: { node, image: SANDBOX_IMAGE }, input, events };
  return { ...base, violations: evaluatePredicate(predicate, events), traceHash: traceHashOf(base) };
}
