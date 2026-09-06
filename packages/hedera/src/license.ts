import { Hbar, NftId, PrivateKey, TokenAssociateTransaction, TokenCreateTransaction, TokenId, TokenMintTransaction, TokenSupplyType, TokenType, TransferTransaction } from "@hashgraph/sdk";
import { client, operatorId, operatorKey } from "./client.ts";
import { mirrorAll } from "./mirror.ts";

const metadataOf = (skillId: string) => `skill:${skillId}`; // 70 bytes for a sha256 hex id; HTS caps NFT metadata at 100

/** Create the SIGIL-LICENSE NFT collection (treasury = operator, supply key = operator, no admin key). Returns token id. */
export async function createLicenseCollection(): Promise<string> {
  const tx = new TokenCreateTransaction()
    .setTokenName("Sigil License")
    .setTokenSymbol("SIGL")
    .setTokenType(TokenType.NonFungibleUnique)
    .setSupplyType(TokenSupplyType.Infinite)
    .setTreasuryAccountId(operatorId())
    .setSupplyKey(operatorKey().publicKey)
    .setMaxTransactionFee(new Hbar(50));
  const receipt = await (await tx.execute(client())).getReceipt(client());
  return receipt.tokenId!.toString();
}

/** Mint one license for skillId to the treasury and transfer it to `toAccountId` (must be associated or auto-associating). txId = the transfer. */
export async function mintLicense(tokenId: string, toAccountId: string, skillId: string): Promise<{ serial: number; txId: string }> {
  const c = client();
  const mint = await (await new TokenMintTransaction().setTokenId(tokenId).setMetadata([Buffer.from(metadataOf(skillId))]).execute(c)).getReceipt(c);
  const serial = mint.serials[0].toNumber();
  const xfer = await new TransferTransaction().addNftTransfer(new NftId(TokenId.fromString(tokenId), serial), operatorId(), toAccountId).execute(c);
  await xfer.getReceipt(c);
  return { serial, txId: xfer.transactionId.toString() };
}

/** True if accountId owns a license NFT for skillId (mirror node read). */
export async function holdsLicense(tokenId: string, accountId: string, skillId: string): Promise<boolean> {
  const nfts = await mirrorAll<{ metadata: string; deleted: boolean }>(`/api/v1/tokens/${tokenId}/nfts?account.id=${accountId}&limit=100`, "nfts");
  return nfts.some((n) => !n.deleted && Buffer.from(n.metadata, "base64").toString("utf8") === metadataOf(skillId));
}

/** Associate the given account with a token (needs that account's 0x-hex ECDSA key). Returns tx id. */
export async function associateToken(accountId: string, privateKey: string, tokenId: string): Promise<string> {
  const c = client();
  const tx = await new TokenAssociateTransaction().setAccountId(accountId).setTokenIds([tokenId]).freezeWith(c);
  const resp = await (await tx.sign(PrivateKey.fromStringECDSA(privateKey))).execute(c);
  await resp.getReceipt(c);
  return resp.transactionId.toString();
}
