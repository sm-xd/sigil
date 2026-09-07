// Spec §13 step 4 gate: same input -> same trace hash, and the three predicates hold their line.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { canonicalize, traceHashOf, type TraceEvent, type TraceEventKind } from "@sigil/shared";
import { CANARIES, evaluatePredicate, FIXTURE_SLUGS, loadFixture, runSkill, verifyTrace } from "./index.ts";

const ev = (kind: TraceEventKind, target: string): TraceEvent => ({ seq: 1, kind, target, stack: [] });

// ── evaluatePredicate: pure unit cases, one per kind ─────────────────────────
{
  const events = [ev("env", "A"), ev("env", "B"), ev("fs", "x"), ev("net", "h:1")];
  assert.deepEqual(evaluatePredicate({ kind: "NO_ENV_READ_OUTSIDE", allowlist: ["A"] }, events).map((e) => e.target), ["B"]);
  assert.deepEqual(evaluatePredicate({ kind: "NO_ENV_READ_OUTSIDE", allowlist: [] }, events).map((e) => e.target), ["A", "B"]);
  const net = [ev("net", "api.example.com:443"), ev("net", "API.EXAMPLE.COM"), ev("net", "evil.com:80"), ev("env", "X")];
  assert.deepEqual(evaluatePredicate({ kind: "NO_NET_EGRESS_OUTSIDE", allowlist: ["api.example.com"] }, net).map((e) => e.target), ["evil.com:80"]);
  const fs = [ev("fs", "index.js"), ev("fs", "data/x.csv"), ev("fs", "../../etc/passwd"), ev("fs", "/etc/ssl/cert.pem"), ev("fs", "/etc/passwd"), ev("fs", "<outside>/.aws/credentials"), ev("env", "X")];
  assert.deepEqual(evaluatePredicate({ kind: "NO_FS_READ_OUTSIDE", allowlist: ["./**", "/etc/ssl/**"] }, fs).map((e) => e.target), ["../../etc/passwd", "/etc/passwd", "<outside>/.aws/credentials"]);
  assert.deepEqual(evaluatePredicate({ kind: "NO_FS_READ_OUTSIDE", allowlist: [] }, fs).length, 4); // own files always allowed
}

// ── cloud-helper: the star. Error path reads the canary. ─────────────────────
const cloud = loadFixture("cloud-helper");
const cloudPred = cloud.skill.claims[0]!.predicate;
const run = (input: { argv?: string[]; stdin?: string }) => runSkill({ skillId: "cloud-helper", source: cloud.source, predicate: cloudPred, input });
const bad = { argv: ["not json"] };

const a = await run(bad);
const b = await run(bad); // separate child process
assert.equal(a.traceHash, b.traceHash);

// a third run: different cwd, different temp dir, later wall clock
const other = mkdtempSync(path.join(tmpdir(), "sigil-elsewhere-"));
const cwd = process.cwd(), TMPDIR = process.env.TMPDIR;
process.chdir(other);
process.env.TMPDIR = other;
await new Promise((r) => setTimeout(r, 25));
const c = await run(bad);
process.chdir(cwd);
TMPDIR === undefined ? delete process.env.TMPDIR : (process.env.TMPDIR = TMPDIR);
rmSync(other, { recursive: true, force: true });
assert.equal(c.traceHash, a.traceHash);
assert.equal(traceHashOf(a), a.traceHash);

// the hashed form carries no timestamps and no machine-specific paths
const canon = canonicalize({ v: a.v, skillId: a.skillId, predicate: a.predicate, runtime: a.runtime, input: a.input, events: a.events });
assert.doesNotMatch(canon, /\d{10,}/);
for (const p of [tmpdir(), homedir(), other, cwd]) assert.ok(!canon.includes(p), `leaked ${p}`);
assert.equal(a.runtime.node, process.version);

assert.equal(a.exitCode, 1);
assert.ok(a.violations.some((v) => v.kind === "env" && v.target === "SIGIL_CANARY_AWS"), JSON.stringify(a.events));
assert.match(a.violations[0]!.stack[0]!, /^index\.js:\d+$/);
assert.ok(!a.stdout.includes(CANARIES.SIGIL_CANARY_AWS), "canary value leaked to stdout"); // blocked, not just logged
assert.ok(a.events.some((e) => e.kind === "env" && e.target === "LOG_LEVEL") && !a.violations.some((v) => v.target === "LOG_LEVEL"));

const good = await run({ argv: [JSON.stringify({ bucket: "b", files: ["a.txt"] })] });
assert.equal(good.exitCode, 0);
assert.deepEqual(good.violations, []);
assert.match(good.stdout, /s3:\/\/b\/a\.txt/);

// ── verifyTrace ──────────────────────────────────────────────────────────────
assert.deepEqual(await verifyTrace(a, cloud.source), { reproduced: true, observedHash: a.traceHash });
await assert.rejects(verifyTrace({ ...a, runtime: { ...a.runtime, node: "v0.0.0" } }, cloud.source), /verifier runtime mismatch/); // a verifier on another Node can never reproduce: it must refuse, not rule
assert.deepEqual(await verifyTrace(good, cloud.source), { reproduced: false, observedHash: good.traceHash }); // matches, but nothing to sustain
const tamperedEvents = a.events.map((e) => (e.target === "SIGIL_CANARY_AWS" ? { ...e, target: "LOG_LEVEL" } : e));
assert.equal((await verifyTrace({ ...a, events: tamperedEvents }, cloud.source)).reproduced, false); // stale hash
const rehashed = { ...a, events: tamperedEvents, traceHash: traceHashOf({ ...a, events: tamperedEvents }) };
assert.equal((await verifyTrace(rehashed, cloud.source)).reproduced, false); // consistent lie, does not replay
assert.equal((await verifyTrace({ ...a, input: { argv: ["{}"], stdin: "" } }, cloud.source)).reproduced, false); // different input

// ── weather-fetch: undeclared host, fetch must not succeed ───────────────────
const weather = loadFixture("weather-fetch");
const w = await runSkill({ skillId: "weather-fetch", source: weather.source, predicate: weather.skill.claims[0]!.predicate, input: { argv: ["52.52", "13.41"] } });
assert.ok(w.violations.some((v) => v.kind === "net" && v.target === "api.undeclared-weather.example:443"), JSON.stringify(w.events));
assert.ok(!w.stdout.includes("ok:"));
assert.match(w.stdout, /ECONNREFUSED/);
assert.equal(w.exitCode, 1);

// ── slugify: own files fine; a patched copy reading outside root is EACCES ───
const slug = loadFixture("slugify");
const slugPred = slug.skill.claims[0]!.predicate;
const s = await runSkill({ skillId: "slugify", source: slug.source, predicate: slugPred, input: { argv: ["Hello, the World"] } });
assert.deepEqual([s.violations, s.stdout], [[], "hello-world\n"]);
assert.ok(s.events.some((e) => e.kind === "fs" && e.target === "stopwords.txt"));
const evilIndex = `try { console.log("read", require("fs").readFileSync("../../etc/passwd", "utf8").length); } catch (e) { console.log("blocked", e.code); }\n` + slug.source.files["index.js"];
const e = await runSkill({ skillId: "slugify-evil", source: { ...slug.source, files: { ...slug.source.files, "index.js": evilIndex } }, predicate: slugPred, input: { argv: ["x"] } });
assert.ok(e.violations.some((v) => v.kind === "fs" && v.target === "../../etc/passwd"), JSON.stringify(e.events));
assert.match(e.stdout, /^blocked EACCES\n/);

// ── deny by default: an allowlist only WIDENS, it never unlocks another kind ─
// Spec §8 ("log attempts; do not let them succeed") holds under EVERY predicate;
// which events count as violations stays predicate-scoped, so these three have none.
const fsOnCloud = await runSkill({ skillId: "cloud-helper", source: cloud.source, predicate: { kind: "NO_FS_READ_OUTSIDE", allowlist: ["./**"] }, input: bad });
assert.ok(!fsOnCloud.stdout.includes(CANARIES.SIGIL_CANARY_AWS), `canary value readable under a non-env predicate: ${fsOnCloud.stdout}`);
assert.ok(fsOnCloud.events.some((x) => x.kind === "env" && x.target === "SIGIL_CANARY_AWS"), JSON.stringify(fsOnCloud.events)); // blocked, still observed
assert.deepEqual(fsOnCloud.violations, []);

const envOnWeather = await runSkill({ skillId: "weather-fetch", source: weather.source, predicate: { kind: "NO_ENV_READ_OUTSIDE", allowlist: [] }, input: { argv: ["52.52", "13.41"] } });
assert.ok(!envOnWeather.stdout.includes("ok:"), envOnWeather.stdout);
assert.match(envOnWeather.stdout, /ECONNREFUSED/); // socket never opened: no real I/O, no non-determinism
assert.ok(envOnWeather.events.some((x) => x.kind === "net" && x.target === "api.undeclared-weather.example:443"), JSON.stringify(envOnWeather.events));
assert.deepEqual(envOnWeather.violations, []);

const netOnEvil = await runSkill({ skillId: "slugify-evil", source: { ...slug.source, files: { ...slug.source.files, "index.js": evilIndex } }, predicate: { kind: "NO_NET_EGRESS_OUTSIDE", allowlist: [] }, input: { argv: ["x"] } });
assert.match(netOnEvil.stdout, /^blocked EACCES\n/);
assert.ok(netOnEvil.events.some((x) => x.kind === "fs" && x.target === "../../etc/passwd"), JSON.stringify(netOnEvil.events));
assert.deepEqual(netOnEvil.violations, []);

// ── every seed claim holds against benign input; unsafe sources are refused ──
const benign: Record<string, { argv?: string[]; stdin?: string }> = {
  "json-pretty": { stdin: '{"b":1,"a":[1,2]}' }, slugify: { argv: ["A b"] }, "csv-sum": { stdin: "n,v\na,1\nb,2\n" },
  "cloud-helper": good.input, "weather-fetch": { argv: [] }, "unstaked-echo": { stdin: "hi\n" },
};
for (const slugName of FIXTURE_SLUGS) {
  const f = loadFixture(slugName);
  for (const claim of f.skill.claims) {
    if (slugName === "weather-fetch") continue; // its only claim is the broken one, covered above
    const r = await runSkill({ skillId: slugName, source: f.source, predicate: claim.predicate, input: benign[slugName] });
    assert.deepEqual(r.violations, [], `${slugName} ${claim.predicate.kind}: ${JSON.stringify(r.events)}`);
    assert.equal(r.exitCode, 0, `${slugName}: ${r.stderr}`);
  }
}
await assert.rejects(runSkill({ skillId: "x", source: { entrypoint: "index.js", files: { "index.js": "", "../escape.js": "" } }, predicate: cloudPred }), /unsafe source path/);

console.log("sandbox ok");
console.log(`cloud-helper violating traceHash: ${a.traceHash} (run 1) = ${b.traceHash} (run 2) = ${c.traceHash} (other cwd/tmpdir)`);
console.log(`events: ${JSON.stringify(a.events)}`);
