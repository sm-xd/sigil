// Env + chain constants. NEXT_PUBLIC_* is inlined at build time, so read each var with its literal name.
import { defineChain } from "viem";

export const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:4021";
export const STAKE_ADDRESS = (process.env.NEXT_PUBLIC_SIGIL_STAKE_ADDRESS ?? "") as `0x${string}` | "";
export const WORLD_MODE = (process.env.NEXT_PUBLIC_WORLD_MODE ?? "mock") as "mock" | "sandbox";
export const WORLD_APP_ID = process.env.NEXT_PUBLIC_WORLD_APP_ID ?? "";
export const WORLD_RP_ID = process.env.NEXT_PUBLIC_WORLD_RP_ID ?? "";
export const WORLD_ACTION_ID = process.env.NEXT_PUBLIC_WORLD_ACTION_ID ?? "sigil-participant";

export const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;
export const ARC_EXPLORER = "https://testnet.arcscan.app";
export const HASHSCAN = "https://hashscan.io/testnet";

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  blockExplorers: { default: { name: "Arcscan", url: ARC_EXPLORER } },
  testnet: true,
});

export const arcTx = (hash: string) => `${ARC_EXPLORER}/tx/${hash}`;
export const hashscanTopic = (id: string) => `${HASHSCAN}/topic/${id}`;
export const hashscanToken = (id: string) => `${HASHSCAN}/token/${id}`;
export const hashscanAccount = (id: string) => `${HASHSCAN}/account/${id}`;
export const hashscanTx = (id: string) => `${HASHSCAN}/transaction/${id}`;
export const hashscanNft = (tokenId: string, serial: number) => `${HASHSCAN}/token/${tokenId}/${serial}`;
/** hcs://1/<topicId> -> HashScan topic link; anything else is returned as-is (or null when not a URL). */
export const sourceLink = (uri: string) => (uri.startsWith("hcs://1/") ? hashscanTopic(uri.slice(8)) : /^https?:/.test(uri) ? uri : null);
