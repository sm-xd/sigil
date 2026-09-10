import { usdc } from "@/lib/format";

/** `10.000000 USDC` in tabular mono, unit in ink-2. seal = capital at risk, off = an off-chain record, ink = everything else. */
export function Money({ v, tone = "ink", unit = true, className = "" }: { v: bigint | string; tone?: "ink" | "seal" | "off"; unit?: boolean; className?: string }) {
  const c = tone === "seal" ? "text-seal" : tone === "off" ? "text-ink-3" : "text-ink";
  return (
    <span className={`mono ${c} ${className}`}>
      {usdc(v)}
      {unit ? <span className={tone === "off" ? "" : "text-ink-2"}> USDC</span> : null}
    </span>
  );
}
