// Pure predicate evaluation over trace events. The target-matching rules (hostOf,
// fsInside, glob semantics) are duplicated in shim.cjs (which cannot import TS);
// keep those in sync. The shim is deliberately stricter about what it ALLOWS —
// it denies every outside env/fs/net touch whatever the predicate is — so a
// blocked event here may still be no violation. That asymmetry is intended.
import path from "node:path";
import type { Predicate, TraceEvent } from "@sigil/shared";

const hostOf = (t: string) => (t.lastIndexOf(":") > 0 ? t.slice(0, t.lastIndexOf(":")) : t).toLowerCase();
const fsInside = (t: string) => !(t === ".." || t.startsWith("../") || t.startsWith("/") || t.startsWith("<outside>"));

/** Which events break the predicate. Own files (inside the sandbox root) are always allowed. */
export function evaluatePredicate(predicate: Predicate, events: TraceEvent[]): TraceEvent[] {
  const { kind, allowlist } = predicate;
  // globs match verbatim: "./**" never matches an outside target ("**" alone would match "/etc/passwd")
  const outside = (t: string) => !fsInside(t) && !allowlist.some((g) => path.posix.matchesGlob(t, g));
  return events.filter((e) => {
    switch (kind) {
      case "NO_ENV_READ_OUTSIDE": return e.kind === "env" && !allowlist.includes(e.target);
      case "NO_NET_EGRESS_OUTSIDE": return e.kind === "net" && !allowlist.some((h) => h.toLowerCase() === hostOf(e.target));
      case "NO_FS_READ_OUTSIDE": return e.kind === "fs" && outside(e.target);
      case "NO_FS_WRITE_OUTSIDE": return e.kind === "fswrite" && outside(e.target);
      case "NO_CHILD_PROCESS": return e.kind === "proc"; // no allowlist: the sandbox never lets one run, so any attempt breaks the claim
      case "NO_DYNAMIC_CODE": return e.kind === "code";
      default: return false;
    }
  });
}
