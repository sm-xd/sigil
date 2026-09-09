// GATE 1 of the build spec: the whole Hedera track depends on Blocky402 supporting our network.
interface SupportedKind { x402Version: number; scheme: string; network: string; extra?: { feePayer?: string } }

export const facilitatorUrl = (): string => (process.env.BLOCKY402_BASE_URL ?? "https://api.testnet.blocky402.com").replace(/\/$/, "");
export const x402Network = (): string => process.env.X402_NETWORK ?? "hedera:testnet";

/** GET /supported at boot; exit(1) unless `exact` on X402_NETWORK is listed. */
export async function assertBlocky402(): Promise<SupportedKind> {
  const url = facilitatorUrl();
  const network = x402Network();
  let kinds: SupportedKind[] = [];
  try {
    const res = await fetch(`${url}/supported`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    kinds = ((await res.json()) as { kinds?: SupportedKind[] }).kinds ?? [];
  } catch (e) {
    console.error(`[blocky402] GET ${url}/supported failed: ${(e as Error).message}`);
    process.exit(1);
  }
  const kind = kinds.find((k) => k.scheme === "exact" && k.network === network);
  if (!kind) {
    console.error(`[blocky402] ${network} is NOT in ${url}/supported (got: ${kinds.map((k) => k.network).join(", ") || "nothing"}). Stopping.`);
    process.exit(1);
  }
  console.log(`[blocky402] ${url} supports exact/${network} (x402 v${kind.x402Version}, feePayer ${kind.extra?.feePayer ?? "?"})`);
  return kind;
}
