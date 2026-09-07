// Spawns the skill in a scrubbed child process with shim.cjs preloaded; events arrive on fd 3.
// ponytail: child_process only, no seccomp; upgrade: gVisor/Docker (SANDBOX_IMAGE is already pinned in the bundle).
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { traceHashOf, type Predicate, type SkillSource, type TraceBundle, type TraceEvent } from "@sigil/shared";
import { makeBundle } from "./trace.ts";

export const CANARIES = { SIGIL_CANARY_AWS: "AKIA0000SIGIL0CANARY", SIGIL_CANARY_TOKEN: "sigil-canary-token" } as const;
const SHIM = fileURLToPath(new URL("./shim.cjs", import.meta.url));
const TIMEOUT_MS = 10_000;
const MAX_OUTPUT = 1 << 20; // ponytail: stdout/stderr capped at 1 MiB each, silently truncated

export interface RunInput { argv?: string[]; stdin?: string }
/** TraceBundle plus the skill's observable output. exitCode null = killed (timeout). Not hash-covered. */
export interface RunResult extends TraceBundle { stdout: string; stderr: string; exitCode: number | null }

/** Run a skill in a scrubbed child process; log+block disallowed env/fs/net; return the canonical bundle. */
export async function runSkill(opts: { skillId: string; source: SkillSource; predicate: Predicate; input?: RunInput }): Promise<RunResult> {
  const { skillId, source, predicate } = opts;
  const input = { argv: opts.input?.argv ?? [], stdin: opts.input?.stdin ?? "" };
  if (!(source.entrypoint in source.files)) throw new Error(`entrypoint ${source.entrypoint} not in source.files`);
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "sigil-")));
  try {
    for (const [rel, content] of Object.entries(source.files)) {
      const abs = path.resolve(root, rel);
      if (path.isAbsolute(rel) || !abs.startsWith(root + path.sep)) throw new Error(`unsafe source path: ${rel}`);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content);
    }
    // Scrubbed env: canaries + allowlisted names (fixed value) and nothing else. The same map goes
    // into the shim config because the OS may inject extra vars (macOS: __CF_USER_TEXT_ENCODING).
    const allow = predicate.kind === "NO_ENV_READ_OUTSIDE" ? Object.fromEntries(predicate.allowlist.map((k) => [k, "sigil-allowlisted"])) : {};
    const env = { ...allow, ...CANARIES };
    const run = await exec(root, source.entrypoint, input, { ...env, SIGIL_SHIM_CONFIG: JSON.stringify({ predicate, root, scrub: scrubPrefixes(), env, canaries: Object.keys(CANARIES) }) });
    return { ...makeBundle(skillId, predicate, run.node, input, run.events), stdout: run.stdout, stderr: run.stderr, exitCode: run.exitCode };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Re-run bundle.input against source; reproduced = observedHash === bundle.traceHash && violations non-empty.
 *  The bundle must also hash to its own traceHash, so an edited event list cannot ride on a stale hash. */
export async function verifyTrace(bundle: TraceBundle, source: SkillSource): Promise<{ reproduced: boolean; observedHash: string }> {
  // runtime.node is hash-covered: a verifier on another Node version can never reproduce, so fail loudly instead of ruling "not reproduced".
  if (bundle.runtime.node !== process.version) throw new Error(`verifier runtime mismatch: the bundle ran on Node ${bundle.runtime.node}, this verifier is ${process.version}; run the verifier on ${bundle.runtime.node}`);
  const rerun = await runSkill({ skillId: bundle.skillId, source, predicate: bundle.predicate, input: bundle.input });
  const observedHash = rerun.traceHash;
  return { reproduced: observedHash === bundle.traceHash && traceHashOf(bundle) === bundle.traceHash && rerun.violations.length > 0, observedHash };
}

/** Absolute prefixes the shim rewrites to "<outside>" so no machine-specific path enters a trace. Longest first. */
function scrubPrefixes(): string[] {
  const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };
  const t = tmpdir(), h = homedir();
  return [...new Set([t, real(t), path.dirname(real(t)), h, real(h), "/tmp", real("/tmp")].map((p) => p.replace(/\/+$/, "")).filter(Boolean))].sort((a, b) => b.length - a.length); // filter: on Linux dirname(tmpdir) is "/", which would scrub every absolute path
}

function exec(root: string, entry: string, input: { argv: string[]; stdin: string }, env: Record<string, string>) {
  return new Promise<{ node: string; events: TraceEvent[]; stdout: string; stderr: string; exitCode: number | null }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--require", SHIM, entry, ...input.argv], {
      cwd: root, env, stdio: ["pipe", "pipe", "pipe", "pipe"],
    });
    let stdout = "", stderr = "", raw = "";
    const collect = (s: NodeJS.ReadableStream, on: (c: string) => void) => { s.setEncoding("utf8"); s.on("data", on); };
    collect(child.stdout!, (c) => { if (stdout.length < MAX_OUTPUT) stdout += c; });
    collect(child.stderr!, (c) => { if (stderr.length < MAX_OUTPUT) stderr += c; });
    collect(child.stdio[3] as NodeJS.ReadableStream, (c) => { raw += c; });
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      const lines = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
      if (lines[0]?.shim !== 1) return reject(new Error(`sandbox shim did not load (exit ${exitCode}): ${stderr.trim()}`));
      resolve({ node: lines[0].node, events: lines.slice(1).filter((e) => e.seq), stdout, stderr, exitCode });
    });
    child.stdin!.on("error", () => {}); // skill may never read stdin
    child.stdin!.end(input.stdin);
  });
}
