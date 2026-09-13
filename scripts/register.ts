// pnpm register <folder> — register a new skill with the gateway. The folder's files become the source bundle
// (the gateway pins it to Hedera as HCS-1 and announces SKILL_REGISTERED on the registry topic); an optional
// skill.json gives { name, author, manifest }. The skill id is the sha256 of the canonical source, so the same
// files always register as the same skill (re-running is a no-op). Prints the id and the "Open a claim" link.
import { config } from "dotenv";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
config({ path: new URL("../.env", import.meta.url).pathname });

const gateway = process.env.GATEWAY_URL || "http://localhost:4021";
const web = process.env.WEB_URL || (gateway.includes("localhost") ? "http://localhost:3000" : "https://dr7shuhqdeo3p.cloudfront.net");

const arg = process.argv[2];
if (!arg) { console.error("usage: pnpm register <folder>   (index.js + any files; optional skill.json with name/author/manifest)"); process.exit(2); }
const dir = resolve(arg);
const metaPath = join(dir, "skill.json");
const meta = (existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : {}) as {
  name?: string; author?: string; manifest?: { entrypoint?: string; declaredEnv?: string[]; declaredHosts?: string[] };
};
const name = meta.name ?? basename(dir);
const author = meta.author ?? process.env.SKILL_AUTHOR ?? "0x0000000000000000000000000000000000000000";
const manifest = { entrypoint: "index.js", declaredEnv: [] as string[], declaredHosts: [] as string[], ...(meta.manifest ?? {}) };
const files = Object.fromEntries(
  readdirSync(dir).filter((f) => f !== "skill.json" && statSync(join(dir, f)).isFile()).map((f) => [f, readFileSync(join(dir, f), "utf8")]),
);
if (!files[manifest.entrypoint]) { console.error(`register: entrypoint "${manifest.entrypoint}" not found in ${dir}`); process.exit(2); }

const source = { entrypoint: manifest.entrypoint, files };
const r = await fetch(`${gateway}/skills`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, author, manifest, source }) });
const body = (await r.json()) as { id: string; sourceUri: string; error?: string };
if (!r.ok) { console.error(`register: ${r.status} ${body.error ?? ""}`); process.exit(1); }

console.log(`register: ${name} ${r.status === 201 ? "registered" : "already registered (same source, same id)"} on ${gateway}`);
console.log(`  id       ${body.id}`);
console.log(`  source   ${body.sourceUri}   (the bundle, pinned on Hedera)`);
console.log(`  files    ${Object.keys(files).join(", ")}   author ${author}`);
console.log(`  page     ${web}/skills/${body.id}`);
console.log(`  stake    ${web}/claims/new?skill=${body.id}`);
