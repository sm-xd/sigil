import "./env.ts";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { canonicalize, claimIdOf, NO_ALLOWLIST_KINDS, PREDICATE_KINDS, PROBE_INPUTS, sha256Hex, skillIdOf, traceHashOf, type Claim, type Predicate, type Skill, type SkillManifest, type SkillSource, type TraceBundle, type TraceEvent } from "@sigil/shared";
import { createTopic, uploadHcs1 } from "@sigil/hedera";
import { runSkill, type RunResult } from "@sigil/sandbox";
import { assertBlocky402, facilitatorUrl, x402Network } from "./blocky402.ts";
import { HttpError, hcs, registryTopic, save, state, type StoredDispute, type StoredSkill } from "./state.ts";
import { priceFor, sourceBytes, x402Middleware } from "./x402.ts";
import { rpContext, verifyWorldProof, worldMode } from "./world.ts";
import { recordResolved, resolveClaim } from "./verdict.ts";

// ── contract shapes (ARCHITECTURE.md) ────────────────────────────────────────
interface SkillSummary extends Skill {
  totalStaked: string; // USDC base units, LIVE + DISPUTED claims
  totalEscrowed: string; // the part of totalStaked that has an openClaim tx on Arc (the rest are off-chain records)
  paidRequests: number; // x402 settlements the gateway served for this skill
  liveClaims: number;
  disputes: number;
  sustainedDisputes: number;
  oldestClaimAgeSec: number | null;
}

// ── input validation (HTTP is a trust boundary) ──────────────────────────────
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isAddr = (v: unknown): v is string => isStr(v) && /^0x[0-9a-fA-F]{40}$/.test(v);
const isUnits = (v: unknown): v is string => isStr(v) && /^\d+$/.test(v);
const isPredicate = (p: unknown): p is Predicate => {
  const x = p as Predicate;
  return !!x && PREDICATE_KINDS.includes(x.kind) && Array.isArray(x.allowlist) && x.allowlist.every((a) => typeof a === "string")
    && (!NO_ALLOWLIST_KINDS.has(x.kind) || x.allowlist.length === 0); // a subprocess or eval is never allowed to run, so these kinds take no allowlist
};
const isManifest = (m: unknown): m is SkillManifest => {
  const x = m as SkillManifest;
  return !!x && isStr(x.entrypoint) && Array.isArray(x.declaredEnv) && Array.isArray(x.declaredHosts);
};
const isEvent = (e: unknown): e is TraceEvent => {
  const x = e as TraceEvent;
  return !!x && typeof x.seq === "number" && isStr(x.kind) && typeof x.target === "string"
    && Array.isArray(x.stack) && x.stack.every((f) => typeof f === "string");
};
const isBundle = (b: unknown): b is TraceBundle => {
  const x = b as TraceBundle;
  return !!x && x.v === 1 && isStr(x.skillId) && isPredicate(x.predicate) && isStr(x.traceHash)
    && !!x.runtime && isStr(x.runtime.node) && isStr(x.runtime.image) && typeof x.runtime.shim === "number"
    && !!x.input && Array.isArray(x.input.argv) && x.input.argv.every((a) => typeof a === "string") && typeof x.input.stdin === "string"
    && Array.isArray(x.events) && x.events.every(isEvent);
};
const isSource = (s: unknown): s is SkillSource => {
  const x = s as SkillSource;
  return !!x && isStr(x.entrypoint) && !!x.files && typeof x.files === "object"
    && typeof x.files[x.entrypoint] === "string" && Object.values(x.files).every((f) => typeof f === "string");
};

const publicSkill = ({ source: _s, ...skill }: StoredSkill): Skill => skill;
const publicDispute = ({ traceBundle: _t, ...dispute }: StoredDispute) => dispute;
const claimsOf = (skillId: string) => Object.values(state.claims).filter((c) => c.skillId === skillId);
const disputesOf = (claims: Claim[]) => Object.values(state.disputes).filter((d) => claims.some((c) => c.id === d.claimId));

function summarize(s: StoredSkill): SkillSummary {
  const claims = claimsOf(s.id);
  const live = claims.filter((c) => c.status === "LIVE" || c.status === "DISPUTED");
  const disputes = disputesOf(claims);
  return {
    ...publicSkill(s),
    totalStaked: live.reduce((a, c) => a + BigInt(c.stakeAmount), 0n).toString(),
    totalEscrowed: live.filter((c) => c.arcTxHash).reduce((a, c) => a + BigInt(c.stakeAmount), 0n).toString(),
    paidRequests: state.payments.filter((p) => p.skillId === s.id).length,
    liveClaims: live.length,
    disputes: disputes.length,
    sustainedDisputes: disputes.filter((d) => d.status === "SUSTAINED").length,
    oldestClaimAgeSec: live.length ? Math.floor((Date.now() - Math.min(...live.map((c) => c.createdAt))) / 1000) : null,
  };
}

const h = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res, next) => { fn(req, res).catch(next); };
const skillOr404 = (id: string): StoredSkill => { const s = state.skills[id]; if (!s) throw new HttpError(404, "skill not found"); return s; };
const claimOr404 = (id: string): Claim => { const c = state.claims[id]; if (!c) throw new HttpError(404, "claim not found"); return c; };

export function createApp() {
  const app = express();
  // Public read/pay API: any origin may call it. Allowed request headers and exposed response headers are
  // exactly what the x402 client sends and reads (@x402/core, packages/agent/src/pay.ts) plus the license header.
  // ponytail: "*" with no credentials; tighten to an origin allowlist if a cookie or bearer session is ever added.
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Hedera-Account, PAYMENT-SIGNATURE");
    res.setHeader("Access-Control-Expose-Headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE");
    if (req.method === "OPTIONS") { res.status(204).end(); return; }
    next();
  });
  app.use(express.json({ limit: "5mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true, network: x402Network(), worldMode: worldMode(),
      registryTopicId: registryTopic(), licenseTokenId: process.env.HEDERA_LICENSE_TOKEN_ID ?? "", stakeAddress: process.env.SIGIL_STAKE_ADDRESS ?? "",
    });
  });

  app.get("/skills", (_req, res) => { res.json({ skills: Object.values(state.skills).map(summarize) }); });

  // Consumption: what it costs to use the skill, who paid, who holds a licence. Licences come from the mirror node.
  const licenceCache = new Map<string, { at: number; list: { serial: number; account: string }[] }>();
  app.get("/skills/:id/access", h(async (req, res) => {
    const skill = skillOr404(req.params.id);
    const tokenId = process.env.HEDERA_LICENSE_TOKEN_ID ?? "";
    const mirror = process.env.HEDERA_MIRROR_URL ?? "https://testnet.mirrornode.hedera.com";
    let licences: { serial: number; account: string }[] = licenceCache.get(skill.id)?.list ?? [];
    const cached = licenceCache.get(skill.id);
    if (tokenId && (!cached || Date.now() - cached.at > 30_000)) {
      try {
        const r = await fetch(`${mirror}/api/v1/tokens/${tokenId}/nfts?limit=100&order=desc`);
        const body = (await r.json()) as { nfts?: { serial_number: number; account_id: string; metadata: string }[] };
        licences = (body.nfts ?? [])
          .filter((n) => Buffer.from(n.metadata, "base64").toString() === `skill:${skill.id}`)
          .map((n) => ({ serial: n.serial_number, account: n.account_id }));
        licenceCache.set(skill.id, { at: Date.now(), list: licences });
      } catch (e) { console.warn(`[access] mirror licence lookup failed: ${(e as Error).message}`); }
    }
    const price = priceFor(sourceBytes(skill));
    res.json({
      skillId: skill.id,
      price: { ...price, perKbUsdc: process.env.PRICE_PER_KB_USDC ?? "0.001" },
      payTo: process.env.HEDERA_OPERATOR_ID ?? "", network: x402Network(), facilitator: facilitatorUrl(), licenseToken: tokenId,
      licences,
      payments: state.payments.filter((p) => p.skillId === skill.id).slice().reverse(),
      howTo: {
        buy: `E2E_FRESH_PAYER=1 pnpm buy ${skill.name}`,
        agent: "E2E_FRESH_PAYER=1 POLICY_MIN_STAKE_USDC=10 POLICY_MIN_CLAIM_AGE_SEC=0 pnpm e2e",
        curl: `curl -i $GATEWAY_URL/skills/${skill.id}/source`,
      },
    });
  }));

  app.get("/skills/:id", (req, res) => {
    const skill = skillOr404(req.params.id);
    const claims = claimsOf(skill.id);
    res.json({
      skill: publicSkill(skill), claims, disputes: disputesOf(claims).map(publicDispute),
      resolutions: state.resolutions.filter((r) => claims.some((c) => c.id === r.claimId)),
      license: { tokenId: process.env.HEDERA_LICENSE_TOKEN_ID ?? "" },
    });
  });

  // 404 unknown ids before the paywall so nobody is quoted a price for nothing.
  app.get("/skills/:id/source", (req, _res, next) => { skillOr404(req.params.id); next(); });
  app.use(x402Middleware()); // license holders pass free (onProtectedRequest); everyone else pays via Blocky402
  app.get("/skills/:id/source", (req, res) => {
    const skill = skillOr404(req.params.id);
    res.json({ skillId: skill.id, source: skill.source, manifest: skill.manifest });
  });

  app.post("/skills", h(async (req, res) => {
    const { name, source, manifest, author, description } = (req.body ?? {}) as Record<string, unknown>;
    if (!isStr(name) || !isSource(source) || !isManifest(manifest) || !isStr(author) || (description !== undefined && typeof description !== "string"))
      throw new HttpError(400, "body: { name, source: { entrypoint, files }, manifest: { entrypoint, declaredEnv, declaredHosts }, author, description? }");
    if (manifest.entrypoint !== source.entrypoint) throw new HttpError(400, "manifest.entrypoint must equal source.entrypoint");
    const id = skillIdOf(source);
    const known = state.skills[id];
    if (known) { // idempotent (seed re-runs); a description arriving later fills the blank, never overwrites
      if (!known.description && isStr(description)) { known.description = description; save(); }
      res.json(publicSkill(known)); return;
    }
    let sourceUri = `local:${id}`; // ponytail: when the HCS-1 upload fails the source lives only in the local index.
    try { sourceUri = (await uploadHcs1(Buffer.from(canonicalize(source)), "application/json")).hrl; }
    catch (e) { console.warn(`[skills] HCS-1 upload failed (non-fatal): ${(e as Error).message}`); }
    const skill: StoredSkill = { id, name, sourceUri, manifest, author, registeredAt: Date.now(), source, ...(isStr(description) ? { description } : {}) };
    state.skills[id] = skill;
    save();
    await hcs(registryTopic(), "SKILL_REGISTERED", "", publicSkill(skill));
    res.status(201).json(publicSkill(skill));
  }));

  app.post("/claims", h(async (req, res) => {
    const { skillId, predicate, stakeAmount, stakedBy, arcTxHash = "", worldProof, nonce } = (req.body ?? {}) as Record<string, unknown>;
    if (!isStr(skillId)) throw new HttpError(400, "skillId required");
    skillOr404(skillId);
    if (!isPredicate(predicate) || !isUnits(stakeAmount) || !isAddr(stakedBy) || typeof arcTxHash !== "string")
      throw new HttpError(400, "body: { skillId, predicate: { kind, allowlist }, stakeAmount (USDC base units), stakedBy (0x…), arcTxHash, worldProof, nonce? }");
    const humanProofRef = await verifyWorldProof(worldProof);
    // id must match what the staker used for openClaim() on Arc, so the caller supplies the nonce it hashed with.
    const id = claimIdOf(skillId, predicate, stakedBy, isStr(nonce) ? nonce : arcTxHash || randomUUID());
    if (state.claims[id]) throw new HttpError(409, "claim already exists");
    let hcsTopicId = "";
    try { hcsTopicId = await createTopic(`sigil:claim:${id}`); }
    catch (e) { console.warn(`[claims] createTopic failed (non-fatal): ${(e as Error).message}`); }
    // ponytail: arcTxHash is recorded, not checked against the chain; verify the ClaimOpened log at SIGIL_STAKE_ADDRESS is the upgrade.
    const claim: Claim = {
      id, skillId, predicate, stakeAmount, stakedBy, humanProofRef, status: "LIVE",
      arcEscrowId: process.env.SIGIL_STAKE_ADDRESS ?? "", arcTxHash, hcsTopicId, createdAt: Date.now(),
    };
    state.claims[id] = claim;
    save();
    await hcs(registryTopic(), "CLAIM_OPENED", id, claim);
    if (hcsTopicId) await hcs(hcsTopicId, "CLAIM_OPENED", id, claim);
    res.status(201).json(claim);
  }));

  // Run the claim's skill in the sandbox here, so a browser can produce dispute evidence without the repo.
  // Same inputs as the agent; returns the first bundle that breaks the predicate, else the last one.
  // ponytail: no rate limit; the sandbox's 10 s timeout bounds one call, upgrade to a queue if it is abused.
  app.post("/claims/:id/probe", h(async (req, res) => {
    const claim = claimOr404(req.params.id);
    const skill = skillOr404(claim.skillId);
    let last: RunResult | null = null;
    for (const { input } of PROBE_INPUTS) {
      last = await runSkill({ skillId: skill.id, source: skill.source, predicate: claim.predicate, input });
      if (last.violations.length) break;
    }
    res.json(last);
  }));

  app.post("/claims/:id/dispute", h(async (req, res) => {
    const claim = claimOr404(req.params.id);
    if (claim.status !== "LIVE") throw new HttpError(409, `claim is ${claim.status}`);
    const { by, counterBond, traceBundle, arcTxHash = "", worldProof } = (req.body ?? {}) as Record<string, unknown>;
    if (!isAddr(by) || !isUnits(counterBond) || typeof arcTxHash !== "string")
      throw new HttpError(400, "body: { by (0x…), counterBond (USDC base units), traceBundle, arcTxHash, worldProof }");
    if (!isBundle(traceBundle))
      throw new HttpError(400, "traceBundle: { v: 1, skillId, predicate: { kind, allowlist }, runtime: { node, image, shim }, input: { argv, stdin }, events: [{ seq, kind, target, stack }], traceHash }");
    const bundle: StoredDispute["traceBundle"] = traceBundle;
    // The evidence must be about THIS claim, or a trace of the same skill under a laxer/stricter predicate
    // would break an honest claim: verifyTrace re-runs the BUNDLE's predicate and input, not the claim's.
    if (bundle.skillId !== claim.skillId) throw new HttpError(409, `traceBundle.skillId ${bundle.skillId} is not this claim's skill ${claim.skillId}`);
    if (canonicalize(bundle.predicate) !== canonicalize(claim.predicate)) throw new HttpError(409, "traceBundle.predicate must equal the claim's predicate");
    if (traceHashOf(bundle) !== bundle.traceHash) throw new HttpError(400, "traceBundle.traceHash does not cover this bundle (recompute traceHashOf)");
    // Deliberately NOT required: bundle.violations non-empty. Disputing with a trace that reproduces
    // nothing is a legitimate way to lose the counter-bond; the resolver already settles that case.
    const humanProofRef = await verifyWorldProof(worldProof);
    if (humanProofRef === claim.humanProofRef) throw new HttpError(409, "one personhood proof cannot hold both sides of a claim");
    const id = `0x${sha256Hex(canonicalize({ claimId: claim.id, by, traceHash: bundle.traceHash }))}`;
    if (state.disputes[id]) throw new HttpError(409, "dispute already exists");
    let evidenceUri = `local:${id}`;
    try { evidenceUri = (await uploadHcs1(Buffer.from(canonicalize(bundle)), "application/json")).hrl; }
    catch (e) { console.warn(`[disputes] HCS-1 upload failed (non-fatal): ${(e as Error).message}`); }
    const dispute: StoredDispute = {
      id, claimId: claim.id, by, counterBond, evidenceUri, traceHash: bundle.traceHash, status: "OPEN", arcTxHash, humanProofRef, createdAt: Date.now(), traceBundle: bundle,
    };
    state.disputes[id] = dispute;
    claim.status = "DISPUTED";
    save();
    await hcs(claim.hcsTopicId || registryTopic(), "DISPUTE_OPENED", claim.id, publicDispute(dispute));
    res.status(201).json(publicDispute(dispute));
  }));

  app.post("/claims/:id/resolve", h(async (req, res) => { res.json(await resolveClaim(req.params.id)); }));

  app.post("/claims/:id/resolved", h(async (req, res) => {
    const { arcTxHash } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof arcTxHash !== "string") throw new HttpError(400, "body: { arcTxHash }");
    res.status(201).json(await recordResolved(req.params.id, arcTxHash));
  }));

  app.post("/world/rp-context", (req, res) => {
    const { action } = (req.body ?? {}) as Record<string, unknown>;
    if (!isStr(action)) throw new HttpError(400, "body: { action }");
    res.json(rpContext(action));
  });

  app.use((err: Error & { status?: number; statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof HttpError ? err.status : err.status ?? err.statusCode ?? 500;
    if (status >= 500) console.error("[gateway]", err instanceof HttpError ? err.message : err);
    res.status(status).json({ error: err.message || String(err) });
  });
  return app;
}

export async function startServer(port = Number(process.env.GATEWAY_PORT ?? 4021)): Promise<Server> {
  await assertBlocky402();
  if (worldMode() === "mock") console.warn("[world] WORLD_MODE=mock: Selfie Check is STUBBED, proofs are { mock: true, nullifier }");
  if (!process.env.SIGIL_STAKE_ADDRESS) console.warn("[arc] SIGIL_STAKE_ADDRESS empty: Arc calls are skipped");
  const app = createApp();
  return new Promise((done) => {
    const server = app.listen(port, () => {
      console.log(`[gateway] listening on http://localhost:${(server.address() as AddressInfo).port} (payTo ${process.env.HEDERA_OPERATOR_ID}, ${process.env.PRICE_PER_KB_USDC ?? "0.001"} USDC/KB)`);
      done(server);
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void startServer();
