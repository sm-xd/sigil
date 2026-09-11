// Idempotent testnet bootstrap: fills the empty HEDERA_* ids in the repo-root .env in place.
// Run: pnpm tsx scripts/hedera-bootstrap.ts   (re-runs keep what is already set)
import { readFileSync, writeFileSync } from "node:fs";
import {
  ENV_PATH,
  associateToken,
  buildUaid,
  client,
  createAccount,
  createLicenseCollection,
  createTopic,
  hashscanUrl,
  mirrorGet,
  operatorId,
  readMessages,
  submitMessage,
  type HashscanKind,
} from "../packages/hedera/src/index.ts";
import { hcsMessage } from "../packages/shared/src/index.ts";

/** Rewrite the existing `KEY=` line (keeping its trailing comment); append only if the line is missing. */
function setEnv(key: string, value: string) {
  const re = new RegExp(`^${key}=[^#\\n]*(#.*)?$`, "m");
  const src = readFileSync(ENV_PATH, "utf8");
  const line = (_: string, comment?: string) => `${key}=${value}${comment ? `   ${comment}` : ""}`;
  writeFileSync(ENV_PATH, re.test(src) ? src.replace(re, line) : `${src.replace(/\n?$/, "\n")}${key}=${value}\n`);
  process.env[key] = value;
}

async function ensure(key: string, kind: HashscanKind, make: () => Promise<string>): Promise<string> {
  const have = process.env[key];
  if (have) {
    console.log(`${key}=${have} (kept) ${hashscanUrl(kind, have)}`);
    return have;
  }
  const v = await make();
  setEnv(key, v);
  console.log(`${key}=${v} (created) ${hashscanUrl(kind, v)}`);
  return v;
}

/** Poll every 2 s until `fn` resolves (a fresh account/topic takes a few seconds to reach the mirror). */
async function onMirror<T>(fn: () => Promise<T>, ms = 30_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (Date.now() - t0 > ms) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function isAssociated(account: string, tokenId: string): Promise<boolean> {
  const r = await onMirror(() => mirrorGet<{ tokens: unknown[] }>(`/api/v1/accounts/${account}/tokens?token.id=${tokenId}`));
  return r.tokens.length > 0;
}

async function ensureAssociated(account: string, key: string, tokenId: string) {
  if (await isAssociated(account, tokenId)) return console.log(`${account} already associated with ${tokenId}`);
  const tx = await associateToken(account, key, tokenId);
  console.log(`${account} associated with ${tokenId} ${hashscanUrl("transaction", tx)}`);
}

async function main() {
  const usdc = process.env.HEDERA_USDC_TOKEN_ID ?? "0.0.429274";
  const op = operatorId();
  console.log(`operator ${op} ${hashscanUrl("account", op)}`);

  const registry = await ensure("HEDERA_REGISTRY_TOPIC_ID", "topic", () => createTopic("sigil:registry:v1"));
  const licenseToken = await ensure("HEDERA_LICENSE_TOKEN_ID", "token", createLicenseCollection);

  let agent = process.env.HEDERA_AGENT_ACCOUNT_ID;
  if (agent && process.env.HEDERA_AGENT_KEY) console.log(`HEDERA_AGENT_ACCOUNT_ID=${agent} (kept) ${hashscanUrl("account", agent)}`);
  else {
    const a = await createAccount(20, -1);
    setEnv("HEDERA_AGENT_KEY", a.privateKey); // .env only — never printed
    setEnv("HEDERA_AGENT_ACCOUNT_ID", a.accountId);
    agent = a.accountId;
    console.log(`HEDERA_AGENT_ACCOUNT_ID=${agent} (created, 20 HBAR) ${hashscanUrl("account", agent)}`);
  }

  await ensureAssociated(op, process.env.HEDERA_OPERATOR_KEY!, usdc);
  // Associate explicitly even when max_automatic_token_associations is -1: the Circle faucet's first USDC drip to an
  // account that relied on auto-association never arrived (2026-09-12), while a drip after an explicit association did.
  const { max_automatic_token_associations: auto } = await onMirror(() => mirrorGet<{ max_automatic_token_associations: number }>(`/api/v1/accounts/${agent}`));
  console.log(`${agent}: max_automatic_token_associations=${auto}; associating USDC and the license token explicitly anyway`);
  await ensureAssociated(agent, process.env.HEDERA_AGENT_KEY!, usdc);
  await ensureAssociated(agent, process.env.HEDERA_AGENT_KEY!, licenseToken);

  // HCS-14 identity for the gateway on the registry topic (once)
  const uaid = buildUaid(op);
  const identities = await readMessages<{ accountId: string }>(registry);
  // Append-only topic: the newest IDENTITY wins, so a changed uaid (e.g. the HCS-14 did→aid migration) is superseded, not edited.
  if (identities.some((m) => m.message.type === "IDENTITY" && m.message.payload.accountId === op && m.message.payload.uaid === uaid)) console.log(`IDENTITY already on registry: ${uaid}`);
  else {
    const r = await submitMessage(registry, hcsMessage("IDENTITY", "", { uaid, accountId: op, role: "gateway" }));
    console.log(`IDENTITY seq ${r.sequenceNumber} ${uaid} ${hashscanUrl("transaction", r.txId)}`);
  }

  client().close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
