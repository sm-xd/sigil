import { TopicCreateTransaction, TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import type { HcsMessage } from "@sigil/shared";
import { client, operatorKey } from "./client.ts";
import { topicMessagesRaw } from "./mirror.ts";

export interface MirrorMessage<T = unknown> {
  sequenceNumber: number;
  consensusTimestamp: string;
  message: HcsMessage<T>;
}

/** Create an append-only topic (submit key = operator, no admin key). Returns topic id. */
export async function createTopic(memo: string): Promise<string> {
  const receipt = await (await new TopicCreateTransaction().setTopicMemo(memo).setSubmitKey(operatorKey().publicKey).execute(client())).getReceipt(client());
  return receipt.topicId!.toString();
}

/** Submit a raw string (operator is the submit key, so the client signature suffices). */
export async function submitRaw(topicId: string, text: string): Promise<{ sequenceNumber: number; txId: string }> {
  const resp = await new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(text).execute(client());
  const receipt = await resp.getReceipt(client());
  return { sequenceNumber: receipt.topicSequenceNumber!.toNumber(), txId: resp.transactionId.toString() };
}

/** Submit one envelope message. */
export async function submitMessage(topicId: string, msg: HcsMessage): Promise<{ sequenceNumber: number; txId: string }> {
  return submitRaw(topicId, JSON.stringify(msg));
}

/** Read messages via the mirror node, ascending, parsed. Skips non-envelope messages. */
export async function readMessages<T = unknown>(topicId: string, opts?: { limit?: number; afterSequence?: number }): Promise<MirrorMessage<T>[]> {
  const out: MirrorMessage<T>[] = [];
  for (const m of await topicMessagesRaw(topicId, opts)) {
    try {
      const j = JSON.parse(m.text);
      if (j?.v === 1 && typeof j.type === "string") out.push({ sequenceNumber: m.sequenceNumber, consensusTimestamp: m.consensusTimestamp, message: j });
    } catch {
      /* not JSON — not an envelope */
    }
  }
  return out;
}
