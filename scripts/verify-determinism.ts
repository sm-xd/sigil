// pnpm exec tsx scripts/verify-determinism.ts [fixture=cloud-helper] [preset=violate | '{"argv":[…],"stdin":"…"}']
// Spec §13 step 4, second machine: run one fixture on the host (runSkill) and inside sigil-sandbox:node22
// (docker: other filesystem/user/hostname, pinned Node, --network none) and compare trace hashes.
// exit 0 equal · 1 mismatch (names the canonical field that differs) · 2 docker missing, daemon down or build failed.
import { spawnSync } from "node:child_process";
import { hostname } from "node:os";
import { fileURLToPath } from "node:url";
import { canonicalize, traceHashOf } from "../packages/shared/src/index.ts";
import { loadFixture, runSkill, SANDBOX_IMAGE, type RunInput, type RunResult } from "../packages/sandbox/src/index.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BUILD = ["build", "-t", SANDBOX_IMAGE, "-f", "packages/sandbox/Dockerfile", "."];
const PRESETS: Record<string, Record<string, RunInput>> = { // same inputs as packages/sandbox/src/index.test.ts
  "cloud-helper": { violate: { argv: ["not json"] }, benign: { argv: [JSON.stringify({ bucket: "b", files: ["a.txt"] })] } },
  "weather-fetch": { violate: { argv: ["52.52", "13.41"] } },
  slugify: { benign: { argv: ["Hello, the World"] } },
  "json-pretty": { benign: { stdin: '{"b":1,"a":[1,2]}' } },
  "csv-sum": { benign: { stdin: "n,v\na,1\nb,2\n" } },
  "unstaked-echo": { benign: { stdin: "hi\n" } },
};
type Who = { platform: string; arch: string; uid: number | undefined; hostname: string };
type Side = RunResult & { who: Who };
// Runs inside the container: same runSkill, job JSON on stdin, bundle JSON on stdout.
const INLINE = `
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { runSkill } from "/app/packages/sandbox/src/index.ts";
const r = await runSkill(JSON.parse(readFileSync(0, "utf8")));
console.log(JSON.stringify({ ...r, who: { platform: process.platform, arch: process.arch, uid: process.getuid?.(), hostname: hostname() } }));`;

const die = (code: number, msg: string): never => { console.error(msg); process.exit(code); };
const docker = (args: string[], opts = {}) => spawnSync("docker", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20, ...opts });

const [slug = "cloud-helper", presetArg] = process.argv.slice(2);
const presets = PRESETS[slug] ?? {};
const input: RunInput | undefined = presetArg?.startsWith("{") ? JSON.parse(presetArg) : presets[presetArg ?? Object.keys(presets)[0]!];
if (!input) die(2, `no input for ${slug}: presets are [${Object.keys(presets)}] or pass JSON {"argv":[],"stdin":""}`);
const { skill, source } = loadFixture(slug);
const job = { skillId: slug, source, predicate: skill.claims[0]!.predicate, input };

const v = docker(["version", "-f", "{{.Server.Version}}"]);
if (v.error && (v.error as NodeJS.ErrnoException).code === "ENOENT") die(2, "docker not installed — cross-machine gate skipped (host-only proof: pnpm --filter @sigil/sandbox test)");
if (v.status !== 0) die(2, `docker daemon not running — cross-machine gate skipped: ${v.stderr.trim()}`);
if (docker(["image", "inspect", SANDBOX_IMAGE]).status !== 0) {
  console.log(`image ${SANDBOX_IMAGE} missing, building: docker ${BUILD.join(" ")}`);
  if (docker(BUILD, { stdio: "inherit" }).status !== 0) die(2, "docker build failed");
}
// ponytail: an existing image is never rebuilt; after editing shim.cjs/runner.ts run the BUILD line yourself.
// A stale shim shows up below as a MISMATCH in `events`, which is the honest signal, not a silent pass.

const host: Side = { ...(await runSkill(job)), who: { platform: process.platform, arch: process.arch, uid: process.getuid?.(), hostname: hostname() } };
const run = docker(["run", "--rm", "-i", "--network", "none", SANDBOX_IMAGE, "--input-type=module", "-e", INLINE], { input: JSON.stringify(job) });
if (run.status !== 0) die(2, `container run failed (exit ${run.status}): ${run.stderr.trim()}`);
const ctr: Side = JSON.parse(run.stdout);

console.log(`fixture ${slug}  predicate ${JSON.stringify(job.predicate)}  input ${JSON.stringify(input)}`);
for (const [tag, s] of [["host", host], ["container", ctr]] as const) console.log(`${tag.padEnd(9)} node=${s.runtime.node}  traceHash=${s.traceHash}  (${s.who.platform}/${s.who.arch} uid=${s.who.uid} hostname=${s.who.hostname})`);
if (traceHashOf(ctr) !== ctr.traceHash) die(1, `container traceHash is not sha256(canonical) of its own bundle: image hashing code differs from host, rebuild: docker ${BUILD.join(" ")}`);
if (host.traceHash === ctr.traceHash) { console.log("MATCH — spec §13 step 4: same input → same trace hash on two machines"); process.exit(0); }
console.log("MISMATCH — canonical fields that differ:");
for (const k of ["v", "skillId", "predicate", "runtime", "input", "events"] as const) {
  if (canonicalize(host[k]) !== canonicalize(ctr[k])) console.log(`  ${k}\n    host:      ${canonicalize(host[k])}\n    container: ${canonicalize(ctr[k])}`);
}
process.exit(1);
