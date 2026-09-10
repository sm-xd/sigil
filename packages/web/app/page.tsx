"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Resolution } from "@sigil/shared";
import { getSkill, getSkills } from "@/lib/api";
import { arcTx } from "@/lib/chain";
import { short } from "@/lib/format";
import { Ext, Ledger } from "@/components/Ledger";
import { Money } from "@/components/Money";

const DIES: [string, string, string][] = [
  ["Claim", "A staker locks USDC in SigilStake behind one predicate about the skill: no env read, no network egress or no filesystem read outside an allowlist.", "Arc · openClaim"],
  ["Consume", "An agent pays for the skill's source per call over x402. Blocky402 settles the payment in HTS USDC and a license NFT is minted to the payer.", "Hedera · x402, HTS"],
  ["Probe", "The agent runs the skill in a deterministic sandbox. Every env, fs and net event is logged; the canonical trace is hashed.", "sandbox · sha256"],
  ["Dispute", "A violation in the trace is evidence. The disputer posts a counter-bond of at least 25% and the trace hash on Arc; the bundle lands on HCS-1.", "Arc · dispute, Hedera · HCS-1"],
  ["Settle", "The verifier re-runs the bundle. If the hash reproduces, resolve() pays stake and bond to the disputer; if not, to the staker.", "Arc · resolve, Hedera · HCS"],
];

// The five rows of ARCHITECTURE.md "Why three chains", verbatim.
const CHAINS: [string, string, string][] = [
  ["Claim records, evidence, outcomes", "Hedera (HCS)", "Sub-cent fees and 3s finality make per-event immutable writes affordable. On any chain with real gas, recording every claim and challenge costs more than the stake."],
  ["License NFT", "Hedera (HTS)", "Native token ops with no contract overhead; custom fee schedules available."],
  ["Paid access", "Hedera (x402 via Blocky402)", "Mandated by the track. Per-call metering at sub-cent cost."],
  ["Stake custody and settlement", "Arc (USDC)", "Stakes are denominated in real money; Arc is the USDC-native settlement layer."],
  ["Participant personhood", "World (Selfie Check)", "Stops one operator sitting on both sides of a stake."],
];

const REAL: [string, string, string][] = [
  ["Blocky402 settlement in HTS USDC", "https://hashscan.io/testnet/transaction/0.0.7162784@1789216091.354310097", "0.0.7162784@1789216091.354310097"],
  ["resolve() settlement on Arc, signed by the Circle Agent Stack wallet", "https://testnet.arcscan.app/tx/0x05489e9d3c65259044e9d13687c19dd27c07ad62e78fc6a90115e1a853b3d9b4", "0x05489e9d…b3d9b4"],
  ["HCS claim topic with the full trail", "https://hashscan.io/testnet/topic/0.0.10499701", "0.0.10499701"],
  ["SigilStake contract on Arc testnet", "https://testnet.arcscan.app/address/0x66fc6324ea9afd68a15f2f68ee5b3083391566fe", "0x66fc6324…1566fe"],
];

/** One poll every 10 s: the summary, plus a detail read only for skills with disputes (the only place a resolution can be). */
async function loadLive() {
  const skills = await getSkills();
  const details = await Promise.all(skills.filter((s) => s.disputes > 0).map((s) => getSkill(s.id)));
  let last: { r: Resolution; at: number } | null = null;
  for (const d of details) {
    for (const r of d.resolutions) {
      const at = d.disputes.find((x) => x.id === r.disputeId)?.createdAt ?? 0;
      if (!last || at > last.at) last = { r, at };
    }
  }
  return {
    skills: skills.length,
    escrowed: skills.reduce((a, s) => a + BigInt(s.totalEscrowed), 0n),
    broken: skills.reduce((a, s) => a + s.sustainedDisputes, 0),
    paid: skills.reduce((a, s) => a + s.paidRequests, 0),
    last: last?.r ?? null,
  };
}

function Section({ n, id, children }: { n: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="page rule-2 py-16 md:py-20">
      <span className="mono text-12 text-ink-2">{n}</span>
      <div>{children}</div>
    </section>
  );
}

function Cell({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <dt className="label">{label}</dt>
      <dd className="mono mt-1 text-28">{children}</dd>
    </div>
  );
}

export default function Landing() {
  const live = useQuery({ queryKey: ["live"], queryFn: loadLive, refetchInterval: 10_000 });
  const d = live.data;
  const dash = <span className="text-ink-3">—</span>;

  return (
    <div>
      <section className="page py-16 md:py-20">
        <span className="mono text-12 text-ink-2">01</span>
        <div>
          <h1 className="display text-40 md:text-56">Sigil</h1>
          <p className="mt-6 max-w-[640px] text-16 md:text-20">Every claim about an AI skill on Sigil has USDC behind it. Produce the trace that breaks the claim and the stake is yours.</p>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link href="/registry" className="btn btn-seal">Open the registry</Link>
            <a href="#proof" className="link text-14">Read the proof</a>
          </div>
        </div>
      </section>

      <Section n="02">
        <h2 className="display text-28">Live from the gateway</h2>
        <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-6 md:grid-cols-4">
          <Cell label="skills listed">{d ? d.skills : dash}</Cell>
          <Cell label="USDC escrowed on Arc">{d ? <Money v={d.escrowed} tone={d.escrowed > 0n ? "seal" : "off"} unit={false} /> : dash}</Cell>
          <Cell label="claims broken">{d ? d.broken : dash}</Cell>
          <Cell label="paid requests">{d ? d.paid : dash}</Cell>
          <Cell label="last settlement" className="col-span-2 md:col-span-4">
            {!d ? dash : !d.last ? <span className="text-14 text-ink-3">none yet</span> : d.last.arcTxHash ? (
              <span className="text-14"><Ext href={arcTx(d.last.arcTxHash)}>{short(d.last.arcTxHash, 10, 6)}</Ext> <span className="text-ink-2">on Arcscan</span></span>
            ) : (
              <span className="text-14">{short(d.last.claimId, 10, 6)} <span className="text-ink-3">off-chain record{d.last.hcsSequence ? ` · HCS seq ${d.last.hcsSequence}` : ""}</span></span>
            )}
          </Cell>
        </dl>
        <p className="mono mt-6 text-12 text-ink-3">{live.isError ? "gateway offline" : !d ? "loading…" : live.isFetching ? "polling…" : "polls every 10 s"}</p>
      </Section>

      <Section n="03">
        <h2 className="display text-28">How a claim dies</h2>
        <div className="mt-6">
          <Ledger>
            <thead><tr><th className="num">#</th><th>step</th><th>what happens</th><th>where</th></tr></thead>
            <tbody>
              {DIES.map(([verb, what, where], i) => (
                <tr key={verb}>
                  <td className="num">{String(i + 1).padStart(2, "0")}</td>
                  <td className="whitespace-nowrap font-medium">{verb}</td>
                  <td>{what}</td>
                  <td className="mono whitespace-nowrap text-12">{where}</td>
                </tr>
              ))}
            </tbody>
          </Ledger>
        </div>
      </Section>

      <Section n="04">
        <h2 className="display text-28">Why three chains</h2>
        <div className="mt-6">
          <Ledger>
            <thead><tr><th>layer</th><th>chain</th><th>why it must be there</th></tr></thead>
            <tbody>
              {CHAINS.map(([layer, chain, why]) => (
                <tr key={layer}><td className="font-medium">{layer}</td><td className="mono whitespace-nowrap text-12">{chain}</td><td>{why}</td></tr>
              ))}
            </tbody>
          </Ledger>
        </div>
      </Section>

      <Section n="05" id="proof">
        <h2 className="display text-28">What is real</h2>
        <div className="mt-6">
          <Ledger>
            <thead><tr><th>what</th><th>where</th></tr></thead>
            <tbody>
              {REAL.map(([what, href, text]) => (
                <tr key={href}><td>{what}</td><td className="mono whitespace-nowrap text-12"><Ext href={href}>{text}</Ext></td></tr>
              ))}
              <tr><td>Selfie Check runs as a labelled mock until World Sandbox access lands.</td><td className="mono whitespace-nowrap text-12 text-ink-3">Mock Selfie Check (World Sandbox access pending)</td></tr>
            </tbody>
          </Ledger>
        </div>
      </Section>

      <footer className="page rule-2 py-16 md:py-20">
        <span className="mono text-12 text-ink-2">Run it</span>
        <div>
          <p className="text-14 text-ink-2">The full cycle, end to end, against Hedera testnet and Arc testnet:</p>
          <pre className="mt-3 overflow-x-auto text-13">E2E_FRESH_PAYER=1 POLICY_MIN_STAKE_USDC=10 POLICY_MIN_CLAIM_AGE_SEC=0 pnpm e2e</pre>
        </div>
      </footer>
    </div>
  );
}
