import { sha256Hex } from "@sigil/shared";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { mirrorGet, topicMessagesRaw } from "./mirror.ts";
import { createTopic, submitRaw } from "./topics.ts";

// HCS-1: topic memo `<sha256>:brotli:base64`, messages `{o, c}` carrying slices of a data: URI.
const CHUNK = 800; // base64 chars per message; keeps the {"o":n,"c":"…"} wrapper under the 1024-byte HCS limit

/** Store bytes as an HCS-1 file (chunked, brotli). Returns topic id and hrl `hcs://1/<topicId>`. */
export async function uploadHcs1(bytes: Uint8Array, mime: string): Promise<{ topicId: string; hrl: string }> {
  const dataUri = `data:${mime};base64,${brotliCompressSync(bytes).toString("base64")}`;
  const topicId = await createTopic(`${sha256Hex(bytes)}:brotli:base64`);
  // ponytail: sequential ≈3 s/chunk (800 B) → ~1 min per 15 KB; batch chunk submits with Promise.all if uploads get slow.
  for (let i = 0, o = 0; i < dataUri.length; i += CHUNK, o++) await submitRaw(topicId, JSON.stringify({ o, c: dataUri.slice(i, i + CHUNK) }));
  return { topicId, hrl: `hcs://1/${topicId}` };
}

/** Reassemble an HCS-1 file from its topic id or hrl. Throws until the mirror has every chunk (content hash must match the memo). */
export async function downloadHcs1(ref: string): Promise<Uint8Array> {
  const topicId = ref.replace(/^hcs:\/\/1\//, "");
  const chunks = (await topicMessagesRaw(topicId)).map((m) => JSON.parse(m.text) as { o: number; c: string }).sort((a, b) => a.o - b.o);
  const b64 = chunks.map((c) => c.c).join("").replace(/^data:[^,]*,/, "");
  const bytes = brotliDecompressSync(Buffer.from(b64, "base64"));
  const { memo } = await mirrorGet<{ memo: string }>(`/api/v1/topics/${topicId}`);
  if (memo.split(":")[0] !== sha256Hex(bytes)) throw new Error(`HCS-1 ${topicId}: content hash != memo (mirror lag or incomplete upload)`);
  return bytes;
}
