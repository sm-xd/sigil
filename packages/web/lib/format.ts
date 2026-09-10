/** Base units -> a fixed decimal string with exactly dp places (the number on screen is the number on the chain). */
function fixed(base: bigint | string, dp: number): string {
  const b = BigInt(base || 0), unit = 10n ** BigInt(dp);
  return `${b / unit}.${(b % unit).toString().padStart(dp, "0")}`;
}
/** USDC base units -> "250.000000" (always 6dp). */
export const usdc = (base: bigint | string) => fixed(base, 6);
/** Tinybar -> "0.00100000" (always 8dp). */
export const hbar = (base: bigint | string) => fixed(base, 8);
/** "12.5" -> 12500000n; throws on garbage so the form can show it. */
export function usdcToBase(amount: string): bigint {
  if (!/^\d+(\.\d{0,6})?$/.test(amount.trim())) throw new Error("amount must be a decimal with at most 6 places");
  const [i, f = ""] = amount.trim().split(".");
  return BigInt(i) * 10n ** 6n + BigInt((f + "000000").slice(0, 6));
}

export const short = (s: string, head = 6, tail = 4) => (s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`);

export function age(sec: number | null | undefined): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
}
export const ageSince = (ms: number) => age(Math.max(0, Math.floor((Date.now() - ms) / 1000)));
