import { AccountCreateTransaction, Client, Hbar, PrivateKey, TransferTransaction, TokenId, AccountId } from "@hashgraph/sdk";
import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export type HashscanKind = "topic" | "token" | "account" | "transaction";

/** Repo root = nearest ancestor holding pnpm-workspace.yaml, so .env loads from any cwd. */
export const REPO_ROOT = (() => {
  let d = import.meta.dirname ?? process.cwd();
  while (!existsSync(join(d, "pnpm-workspace.yaml"))) {
    const up = dirname(d);
    if (up === d) throw new Error("pnpm-workspace.yaml not found above " + d);
    d = up;
  }
  return d;
})();
export const ENV_PATH = join(REPO_ROOT, ".env");
dotenv.config({ path: ENV_PATH });

export const NETWORK = (process.env.HEDERA_NETWORK ?? "testnet") as "testnet" | "mainnet";
export const MIRROR_URL = process.env.HEDERA_MIRROR_URL ?? "https://testnet.mirrornode.hedera.com";

function env(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`${k} missing in ${ENV_PATH}`);
  return v;
}

/** Operator account id from HEDERA_OPERATOR_ID. */
export function operatorId(): string {
  return env("HEDERA_OPERATOR_ID");
}
/** Operator ECDSA key (0x-hex in HEDERA_OPERATOR_KEY). */
export function operatorKey(): PrivateKey {
  return PrivateKey.fromStringECDSA(env("HEDERA_OPERATOR_KEY"));
}

let _client: Client | undefined;
/** Operator-paid SDK client (singleton). One-shot scripts must call `.close()` or the process hangs. */
export function client(): Client {
  return (_client ??= Client.forName(NETWORK).setOperator(operatorId(), operatorKey()));
}

/** HashScan URL for the configured network. */
export function hashscanUrl(kind: HashscanKind, id: string): string {
  return `https://hashscan.io/${NETWORK}/${kind}/${id}`;
}

/** New ECDSA account funded by the operator. -1 = unlimited auto token associations. The key is 0x-hex: persist it, never log it. */
export async function createAccount(initialHbar: number, maxAutoAssociations = -1): Promise<{ accountId: string; privateKey: string }> {
  const key = PrivateKey.generateECDSA();
  const receipt = await (
    await new AccountCreateTransaction()
      .setKeyWithoutAlias(key.publicKey)
      .setInitialBalance(new Hbar(initialHbar))
      .setMaxAutomaticTokenAssociations(maxAutoAssociations)
      .execute(client())
  ).getReceipt(client());
  return { accountId: receipt.accountId!.toString(), privateKey: `0x${key.toStringRaw()}` };
}

/** Move `amount` base units of an HTS fungible token from `from` (signed with its key) to `to`. */
export async function transferToken(tokenId: string, from: string, fromKey: string, to: string, amount: number): Promise<string> {
  const tx = await new TransferTransaction()
    .addTokenTransfer(TokenId.fromString(tokenId), AccountId.fromString(from), -amount)
    .addTokenTransfer(TokenId.fromString(tokenId), AccountId.fromString(to), amount)
    .freezeWith(client())
    .sign(PrivateKey.fromStringECDSA(fromKey));
  const resp = await tx.execute(client());
  await resp.getReceipt(client());
  return resp.transactionId.toString();
}
