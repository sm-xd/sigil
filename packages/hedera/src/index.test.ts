// §13 step-2 gate: a record written and read back, on real testnet. Run: pnpm --filter @sigil/hedera test
import { hcsMessage, sha256Hex } from "@sigil/shared";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { buildUaid, client, createTopic, downloadHcs1, hashscanUrl, holdsLicense, mintLicense, readMessages, submitMessage, uploadHcs1 } from "./index.ts";

const env = (k: string) => {
  const v = process.env[k];
  assert.ok(v, `${k} missing — run scripts/hedera-bootstrap.ts`);
  return v;
};

/** Poll `fn` every 2 s until `ok` (errors count as not-ok: mirror lag) or `ms` elapse. */
async function until<T>(fn: () => Promise<T>, ok: (t: T) => boolean, ms: number): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v !== undefined && ok(v)) return v;
    if (Date.now() - t0 > ms) throw new Error(`mirror did not catch up within ${ms} ms`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// (0) HCS-14 uaid:aid — pure, runs before any network call. Vector hand-computed with the standard's
// algorithm and cross-checked against the reference SDK's own canonical.ts/base58.ts on this input.
const uaid = buildUaid("0.0.123456", { network: "testnet" });
assert.equal(
  uaid,
  "uaid:aid:6vSr6yXsiHd3UgtDVzg6MCQXUFHujMpRgpQioarZKbPgMukjwaW1HNAPSzei96nVqS;uid=0.0.123456;registry=sigil;proto=rest;nativeId=hedera:testnet:0.0.123456",
);
assert.equal(buildUaid("0.0.123456", { network: "testnet" }), uaid); // deterministic
assert.notEqual(buildUaid("0.0.999", { network: "testnet" }), uaid); // nativeId is the uniqueness anchor
console.log("(0) hcs-14", uaid);

// (a) envelope written to a fresh topic, read back equal via the mirror
const topic = await createTopic(`sigil:test:${Date.now()}`);
const msg = hcsMessage("CLAIM_OPENED", `0x${"ab".repeat(32)}`, { skillId: "s", predicate: { kind: "NO_ENV_READ_OUTSIDE", allowlist: ["HOME"] } });
const sent = await submitMessage(topic, msg);
console.log("(a) topic", hashscanUrl("topic", topic), "\n    tx", hashscanUrl("transaction", sent.txId));
const got = await until(() => readMessages(topic), (m) => m.length > 0, 15_000);
assert.equal(got[0].sequenceNumber, sent.sequenceNumber);
assert.deepEqual(got[0].message, msg);

// (b) HCS-1 round trip, 5 KB random (incompressible) bytes
const bytes = randomBytes(5 * 1024);
const up = await uploadHcs1(bytes, "application/octet-stream");
console.log("(b) hcs-1", up.hrl, hashscanUrl("topic", up.topicId));
const down = await until(() => downloadHcs1(up.hrl), (b) => b.length === bytes.length, 30_000);
assert.ok(Buffer.from(down).equals(bytes));

// (c) license NFT: mint to the agent account, holdsLicense true for that skill, false for another
const tokenId = env("HEDERA_LICENSE_TOKEN_ID");
const agent = env("HEDERA_AGENT_ACCOUNT_ID");
const skillId = sha256Hex(`skill-${Date.now()}`);
const lic = await mintLicense(tokenId, agent, skillId);
console.log("(c) serial", lic.serial, hashscanUrl("transaction", lic.txId), "\n    token", hashscanUrl("token", tokenId));
assert.ok(await until(() => holdsLicense(tokenId, agent, skillId), Boolean, 20_000));
assert.equal(await holdsLicense(tokenId, agent, sha256Hex("other")), false);

console.log("ok");
client().close();
