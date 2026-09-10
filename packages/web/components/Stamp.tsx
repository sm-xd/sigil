const TONE: Record<string, "seal" | "upheld"> = { BROKEN: "seal", SUSTAINED: "seal", CLAIM_BROKEN: "seal", UPHELD: "upheld", REJECTED: "upheld", CLAIM_UPHELD: "upheld" };

/** Status stamp: bordered, never filled. The BROKEN and UPHELD families are coloured and slightly askew; LIVE, RECORDED and the rest are ink. */
export function Stamp({ s, className = "" }: { s: string; className?: string }) {
  return <span className={`stamp ${className}`} data-tone={TONE[s] ?? "ink"}>{s.replace(/_/g, " ")}</span>;
}
