// @sigil/sandbox preload shim. Loaded via --require before the skill's entrypoint.
// Every env/fs/net touch is written synchronously to fd 3 as one JSON line
// ({seq, kind, target, stack}) at the moment it happens, so nothing is buffered
// and process.exit / uncaught exceptions cannot lose events. Access is denied by
// default and a predicate's allowlist only WIDENS it, so a blocked call never
// succeeds under any predicate; which events count as violations stays
// predicate-scoped and is decided later by predicates.ts.
// ponytail: JS-level interposition only (no seccomp/namespaces); child processes,
// workers, UDP and native bindings are refused outright. Upgrade: gVisor/Docker.
"use strict";
const fs = require("fs"), path = require("path"), net = require("net"), dns = require("dns");
const http = require("http"), https = require("https"), cp = require("child_process");
const { fileURLToPath } = require("url");

const cfg = JSON.parse(process.env.SIGIL_SHIM_CONFIG || "null");
if (!cfg) { process.stderr.write("sigil shim: SIGIL_SHIM_CONFIG missing, refusing to run\n"); process.exit(70); }
delete process.env.SIGIL_SHIM_CONFIG;
const { predicate, scrub } = cfg;
const root = fs.realpathSync(cfg.root);
const isKind = (k) => predicate.kind === k;
const writeSync = fs.writeSync, Err = Error, MAX_EVENTS = 10_000;
let seq = 0;

// ── event emission ─────────────────────────────────────────────────────────
// Node internals touch env/fs/dns on the skill's behalf (console.log -> FORCE_COLOR,
// require -> readFileSync, net.connect -> dns.lookup). Blocking is unconditional;
// logging follows one policy per kind so a benign skill produces a clean trace:
//   env  logged iff the nearest non-shim frame is not Node-internal
//   fs   logged iff skill-attributable OR blocked
//   net  socket layer always (tls/http2/undici reach it only through internals);
//        http/https/fetch layers only when they block; dns like fs
function loc(line) { // "    at fn (/a/b.js:3:5)" | "    at /a/b.js:3:5" -> ["/a/b.js", "3"] | null
  line = line.trim().replace(/^at\s+/, "");
  if (line.endsWith(")")) line = line.slice(line.lastIndexOf("(") + 1, -1);
  const m = /^(?:file:\/\/)?(.*):(\d+):\d+$/.exec(line);
  return m && [m[1], m[2]];
}
function where() { // stack: frames inside root as "file:line"; internal: nearest non-shim frame is Node-internal
  let s = "";
  try { const lim = Err.stackTraceLimit; Err.stackTraceLimit = 50; s = String(new Err().stack || ""); Err.stackTraceLimit = lim; } catch {}
  const stack = [];
  let internal = null;
  for (const line of s.split("\n")) {
    const l = loc(line);
    if (!l || l[0] === __filename) continue;
    if (internal === null) internal = l[0].startsWith("node:");
    if (l[0].startsWith(root + "/")) stack.push(`${l[0].slice(root.length + 1)}:${l[1]}`);
  }
  return { stack, internal: internal === true };
}
function record(kind, target, { always = false, blocked = false } = {}) {
  const w = where();
  if (!(always || blocked || !w.internal)) return;
  writeSync(3, JSON.stringify({ seq: ++seq, kind, target, stack: w.stack }) + "\n");
  if (seq >= MAX_EVENTS) { writeSync(3, JSON.stringify({ truncated: true }) + "\n"); process.exit(71); } // deterministic cut-off
}
writeSync(3, JSON.stringify({ shim: 1, node: process.version }) + "\n");

// ── env ────────────────────────────────────────────────────────────────────
// process.env becomes a Proxy whose target holds only allowed keys: util.inspect
// bypasses Proxy traps and formats the target, so blocked values must not be there.
// The canaries are never readable; every other key needs the env predicate to name it.
const canaries = new Set(cfg.canaries);
const envAllowed = (k) => !canaries.has(k) && isKind("NO_ENV_READ_OUTSIDE") && predicate.allowlist.includes(k);
const PROTO = new Set(["toJSON", "then", "constructor", "valueOf", "toString", "__proto__", "hasOwnProperty", "propertyIsEnumerable"]);
const envKey = (k) => typeof k === "string" && !PROTO.has(k);
const fullEnv = cfg.env;
process.env = new Proxy(Object.fromEntries(Object.entries(fullEnv).filter(([k]) => envAllowed(k))), {
  get(t, k) { if (envKey(k)) record("env", k); return t[k]; },
  has(t, k) { if (envKey(k)) record("env", k); return k in t; },
  getOwnPropertyDescriptor(t, k) { if (envKey(k)) record("env", k); return Reflect.getOwnPropertyDescriptor(t, k); },
  ownKeys(t) { for (const k of Object.keys(fullEnv)) if (!envAllowed(k)) record("env", k); return Reflect.ownKeys(t); }, // enumeration touches hidden vars too
});

// ── fs: target format (keep in sync with predicates.ts) ────────────────────
//   inside root            -> "rel/path"
//   relative arg escaping  -> "../x"            (what the skill wrote; location-independent)
//   absolute arg           -> "/abs/path", home/tmp prefixes replaced by "<outside>"
function fsTarget(p) {
  if (p instanceof URL) p = fileURLToPath(p); else if (Buffer.isBuffer(p)) p = p.toString();
  if (typeof p !== "string") return null; // fd or junk: fds were already opened through us
  const abs = path.resolve(p);
  if (abs === root) return ".";
  if (abs.startsWith(root + "/")) return abs.slice(root.length + 1);
  if (!path.isAbsolute(p)) return path.normalize(p);
  for (const pre of scrub) if (abs === pre || abs.startsWith(pre + "/")) return "<outside>" + abs.slice(pre.length);
  return abs;
}
const fsInside = (t) => !(t === ".." || t.startsWith("../") || t.startsWith("/") || t.startsWith("<outside>"));
const fsAllowed = (t) => fsInside(t) || (isKind("NO_FS_READ_OUTSIDE") && predicate.allowlist.some((g) => path.posix.matchesGlob(t, g))); // verbatim: "./**" never matches outside
const eacces = (t) => Object.assign(new Err(`EACCES: permission denied, open '${t}'`), { code: "EACCES", errno: -13, syscall: "open", path: t });
let nested = 0; // readFileSync calls openSync internally: check both, log once
function guardFs(obj, name, mode) { // mode: "sync" throws | "cb" errors via last arg | "promise" rejects
  const orig = obj[name];
  if (!orig) return;
  obj[name] = function (p, ...rest) {
    const t = fsTarget(p);
    if (t !== null) {
      const ok = fsAllowed(t);
      if (!nested) record("fs", t, { blocked: !ok });
      if (!ok) {
        const err = eacces(t), cb = rest[rest.length - 1];
        if (mode === "promise") return Promise.reject(err);
        if (mode === "cb" && typeof cb === "function") { process.nextTick(cb, name === "exists" ? false : err); return; }
        throw err;
      }
    }
    if (mode !== "sync") return orig.call(this, p, ...rest);
    nested++;
    try { return orig.call(this, p, ...rest); } finally { nested--; }
  };
}
for (const n of ["readFileSync", "openSync", "createReadStream", "statSync", "lstatSync", "readdirSync", "opendirSync", "existsSync", "accessSync", "copyFileSync", "cpSync", "globSync"]) guardFs(fs, n, "sync");
for (const n of ["readFile", "open", "stat", "lstat", "readdir", "opendir", "exists", "access", "copyFile", "cp", "glob"]) guardFs(fs, n, "cb");
for (const n of ["readFile", "open", "stat", "lstat", "readdir", "opendir", "access", "copyFile", "cp"]) guardFs(fs.promises, n, "promise");
guardFs(fs.promises, "glob", "sync"); // returns an async iterator, so a sync throw is the only way to refuse
guardFs(fs, "openAsBlob", "promise");

// ── net: target is "host:port" for connects, bare "host" for DNS lookups ───
const hostOf = (t) => (t.lastIndexOf(":") > 0 ? t.slice(0, t.lastIndexOf(":")) : t).toLowerCase();
const netAllowed = (t) => isKind("NO_NET_EGRESS_OUTSIDE") && predicate.allowlist.some((h) => h.toLowerCase() === hostOf(t));
const econn = (t) => Object.assign(new Err(`ECONNREFUSED: connection to ${t} blocked by sigil sandbox`), { code: "ECONNREFUSED", syscall: "connect", address: hostOf(t) });

const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) { // choke point for net/tls/http/https/http2/undici
  const o = (Array.isArray(args[0]) ? args[0] : net._normalizeArgs(args))[0]; // createConnection passes a pre-normalized array
  const t = o.path ? fsTarget(String(o.path)) : `${o.host || "localhost"}:${o.port}`;
  record("net", t, { always: true });
  if (!netAllowed(t)) { process.nextTick(() => this.destroy(econn(t))); return this; }
  return origConnect.apply(this, args);
};
function httpTarget(a, b, defPort) {
  let hostname, port, protocol, o = a;
  if (typeof a === "string" || a instanceof URL) { const u = new URL(String(a)); ({ hostname, port, protocol } = u); o = b && typeof b === "object" ? b : {}; }
  hostname = o.hostname || o.host || hostname || "localhost";
  port = o.port || port || (protocol === "https:" ? 443 : defPort);
  return `${hostname}:${port}`;
}
const refuseNet = (t) => { record("net", t, { always: true }); return econn(t); }; // blocked above the socket layer: log here, socket never reached
for (const [mod, defPort] of [[http, 80], [https, 443]]) for (const n of ["request", "get"]) {
  const orig = mod[n];
  mod[n] = function (a, b, ...rest) { const t = httpTarget(a, b, defPort); if (!netAllowed(t)) throw refuseNet(t); return orig.call(this, a, b, ...rest); };
}
function guardDns(obj, name, mode) {
  const orig = obj[name];
  if (!orig) return;
  obj[name] = function (host, ...rest) {
    const t = String(host), ok = netAllowed(t);
    record("net", t, { blocked: !ok });
    if (!ok) {
      const cb = rest[rest.length - 1];
      if (mode === "promise") return Promise.reject(econn(t));
      if (typeof cb === "function") { process.nextTick(cb, econn(t)); return; }
      throw econn(t);
    }
    return orig.call(this, host, ...rest);
  };
}
const RESOLVERS = ["lookup", "resolve", "resolve4", "resolve6", "resolveAny", "resolveCname", "resolveCaa", "resolveMx", "resolveNaptr", "resolveNs", "resolvePtr", "resolveSoa", "resolveSrv", "resolveTxt", "reverse"];
for (const n of RESOLVERS) { guardDns(dns, n, "cb"); guardDns(dns.Resolver.prototype, n, "cb"); guardDns(dns.promises, n, "promise"); guardDns(dns.promises.Resolver.prototype, n, "promise"); }
const origFetch = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  const u = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  const t = `${u.hostname}:${u.port || (u.protocol === "https:" ? 443 : 80)}`;
  if (!netAllowed(t)) throw Object.assign(new TypeError("fetch failed"), { cause: refuseNet(t) });
  return origFetch(input, init);
};

// ── escape hatches with no predicate vocabulary: refused outright ──────────
const refuse = (what) => () => { throw Object.assign(new Err(`EACCES: ${what} refused by sigil sandbox`), { code: "EACCES", syscall: what }); };
for (const n of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) cp[n] = refuse(n);
require("worker_threads").Worker = refuse("worker");
require("dgram").createSocket = refuse("dgram");
process.binding = process._linkedBinding = process.dlopen = refuse("binding");
require("module").syncBuiltinESMExports();
