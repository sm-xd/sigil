import { MIRROR_URL } from "./client.ts";

type Page = Record<string, unknown> & { links?: { next: string | null } };

/** GET a mirror-node REST path. Throws with `.status` on non-2xx. */
export async function mirrorGet<T>(path: string): Promise<T> {
  const res = await fetch(MIRROR_URL + path);
  if (!res.ok) throw Object.assign(new Error(`mirror ${res.status} ${path}`), { status: res.status });
  return res.json() as Promise<T>;
}

/** Collect `key` across pages by following `links.next`, up to `max` items. 404 (not yet on mirror) = empty. */
export async function mirrorAll<T>(path: string, key: string, max = Infinity): Promise<T[]> {
  const out: T[] = [];
  for (let next: string | null = path; next && out.length < max; ) {
    const page: Page | null = await mirrorGet<Page>(next).catch((e) => {
      if (e.status === 404) return null;
      throw e;
    });
    if (!page) break;
    out.push(...((page[key] as T[]) ?? []));
    next = page.links?.next ?? null;
  }
  return out.slice(0, max);
}

interface RawTopicMessage {
  sequence_number: number;
  consensus_timestamp: string;
  message: string; // base64
  chunk_info: { initial_transaction_id: { account_id: string; transaction_valid_start: string }; number: number; total: number } | null;
}

/** Ascending topic messages, base64-decoded; SDK-chunked messages (>1 KB) are reassembled by initial tx id. */
export async function topicMessagesRaw(topicId: string, opts: { limit?: number; afterSequence?: number } = {}): Promise<{ sequenceNumber: number; consensusTimestamp: string; text: string }[]> {
  const q = "limit=100&order=asc" + (opts.afterSequence ? `&sequencenumber=gt:${opts.afterSequence}` : "");
  const raw = await mirrorAll<RawTopicMessage>(`/api/v1/topics/${topicId}/messages?${q}`, "messages", opts.limit);
  const out: { sequenceNumber: number; consensusTimestamp: string; parts: Buffer[] }[] = [];
  const open = new Map<string, number>(); // chunk group -> index in out
  for (const m of raw) {
    const ci = m.chunk_info;
    const group = ci && ci.total > 1 ? `${ci.initial_transaction_id.account_id}@${ci.initial_transaction_id.transaction_valid_start}` : null;
    const part = Buffer.from(m.message, "base64");
    if (group && open.has(group)) out[open.get(group)!].parts.push(part);
    else {
      if (group) open.set(group, out.length);
      out.push({ sequenceNumber: m.sequence_number, consensusTimestamp: m.consensus_timestamp, parts: [part] });
    }
  }
  return out.map(({ parts, ...m }) => ({ ...m, text: Buffer.concat(parts).toString("utf8") }));
}

export async function accountBalance(accountId: string): Promise<{ hbar: string; tokens: Record<string, string> }> {
  const a = await mirrorGet<{ balance: { balance: number; tokens: { token_id: string; balance: number }[] } }>(`/api/v1/accounts/${accountId}`);
  const tokens: Record<string, string> = {};
  for (const t of a.balance.tokens) tokens[t.token_id] = String(t.balance);
  return { hbar: String(a.balance.balance / 1e8), tokens };
}
