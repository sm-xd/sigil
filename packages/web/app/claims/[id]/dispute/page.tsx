"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePublicClient, useWriteContract } from "wagmi";
import { isAddress } from "viem";
import type { TraceBundle } from "@sigil/shared";
import { ERC20_ABI, SIGIL_STAKE_ABI } from "@/lib/abi";
import { ApiError, findClaim, getSkill, postDispute, type WorldProof } from "@/lib/api";
import { STAKE_ADDRESS, USDC_ADDRESS, arcTx } from "@/lib/chain";
import { usdc, usdcToBase } from "@/lib/format";
import { traceHashOf, validateBundle } from "@/lib/hash";
import { HumanCheck } from "@/components/HumanCheck";
import { Ext, Hash, Steps, type Step } from "@/components/Ledger";
import { Money } from "@/components/Money";
import { MoneyPanel } from "@/components/MoneyPanel";
import { Stamp } from "@/components/Stamp";
import { useArcWallet } from "@/components/Wallet";

export default function Page() { return <Suspense><Dispute /></Suspense>; }

function Dispute() {
  const { id: claimId } = useParams<{ id: string }>();
  const skillParam = useSearchParams().get("skill");
  const qc = useQueryClient();
  const found = useQuery({ queryKey: ["claim", claimId, skillParam], queryFn: () => findClaim(claimId, skillParam) });
  const skillId = found.data?.detail.skill.id ?? "";
  // Same cache entry MoneyPanel polls, so the status stamp here moves with the money.
  const live = useQuery({ queryKey: ["skill", skillId], queryFn: () => getSkill(skillId), enabled: !!skillId, refetchInterval: 3_000 });
  const { address, onArc } = useArcWallet();
  const { writeContractAsync } = useWriteContract();
  const pub = usePublicClient();

  const [text, setText] = useState("");
  const [bond, setBond] = useState("");
  const [manualAddr, setManualAddr] = useState("");
  const [proof, setProof] = useState<WorldProof | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const claim = live.data?.claims.find((c) => c.id === claimId) ?? found.data?.claim;
  const stake = claim ? BigInt(claim.stakeAmount) : 0n;
  const minBond = stake / 4n; // minBondBps 2500
  // The contract holding this claim's stake, or "" (undeployed, or an off-chain record — SigilStake.dispute() would revert "not live").
  const escrow = claim?.arcTxHash ? STAKE_ADDRESS : "";
  useEffect(() => { if (claim && !bond) setBond(usdc(minBond)); }, [claim, bond, minBond]);

  // Parse + validate + hash the pasted bundle on every keystroke; it is small.
  let bundle: TraceBundle | null = null, bundleErr = "", computed = "";
  if (text.trim()) {
    try {
      const parsed: unknown = JSON.parse(text);
      bundleErr = validateBundle(parsed) ?? "";
      if (!bundleErr) { bundle = parsed as TraceBundle; computed = traceHashOf(bundle); }
    } catch (e) { bundleErr = `JSON: ${(e as Error).message}`; }
  }
  const hashOk = !!bundle && computed === bundle.traceHash;
  const skillOk = !!bundle && !!claim && bundle.skillId === claim.skillId;

  let bondBase: bigint | null = null, bondErr = "";
  try { bondBase = usdcToBase(bond || "0"); if (claim && bondBase < minBond) bondErr = `minimum counter-bond is 25% of the stake (${usdc(minBond)})`; } catch (e) { bondErr = (e as Error).message; }

  const by = address ?? manualAddr;
  const ready = !!claim && claim.status === "LIVE" && hashOk && skillOk && !!bondBase && !bondErr && !!proof && isAddress(by) && (!escrow || onArc) && !busy && !done;

  const loadExample = async () => setText(JSON.stringify(await fetch("/example-trace.json").then((r) => r.json()), null, 2));
  const onFile = (f: File | undefined) => { if (f) f.text().then(setText); };
  const setStep = (i: number, patch: Partial<Step>) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const submit = async () => {
    if (!ready || !bundle || !bondBase || !proof || !claim) return;
    setBusy(true);
    setSteps([
      { label: escrow ? `approve USDC ${usdc(bondBase)} → SigilStake` : `${STAKE_ADDRESS ? "claim is an off-chain record" : "contract not deployed"} — recording off-chain (arcTxHash "")`, state: escrow ? "idle" : "ok" },
      { label: `dispute(claimId, ${usdc(bondBase)}, 0x${bundle.traceHash.slice(0, 12)}…)`, state: "idle" },
      { label: "POST /claims/:id/dispute", state: "idle" },
    ]);
    let arcTxHash = "", cur = 0;
    const run = (i: number) => { cur = i; setStep(i, { state: "run" }); };
    try {
      if (escrow) {
        run(0);
        const a = await writeContractAsync({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "approve", args: [escrow, bondBase] });
        await pub?.waitForTransactionReceipt({ hash: a });
        setStep(0, { state: "ok", note: <Ext href={arcTx(a)}>tx</Ext> });
        run(1);
        arcTxHash = await writeContractAsync({ address: escrow, abi: SIGIL_STAKE_ABI, functionName: "dispute", args: [claimId as `0x${string}`, bondBase, `0x${bundle.traceHash}`] });
        await pub?.waitForTransactionReceipt({ hash: arcTxHash as `0x${string}` });
        setStep(1, { state: "ok", note: <Ext href={arcTx(arcTxHash)}>tx</Ext> });
      } else {
        setStep(1, { state: "ok", note: "skipped" });
      }
      run(2);
      const d = await postDispute(claimId, { by, counterBond: bondBase.toString(), traceBundle: bundle, arcTxHash, worldProof: proof });
      setStep(2, { state: "ok", note: <>{d.status} · evidence {d.evidenceUri}</> });
      setDone(true);
      await qc.invalidateQueries({ queryKey: ["skill", skillId] });
      await qc.invalidateQueries({ queryKey: ["claim", claimId] });
    } catch (e) {
      const msg = e instanceof ApiError ? `${e.status}: ${e.message}` : (e as Error).message;
      setStep(cur, { state: "err", note: msg });
    } finally { setBusy(false); }
  };

  if (found.isLoading || !claim) {
    return (
      <div className="page py-7">
        <h1 className="display text-20">Dispute</h1>
        <p className={`mono text-13 ${found.isLoading ? "text-ink-3" : "text-seal"}`}>
          {found.isLoading ? "Locating the claim…" : `Claim ${claimId} not found${found.error ? `: ${(found.error as Error).message}` : ""}. Run pnpm seed or open one first.`}
        </p>
      </div>
    );
  }

  const bondText = bondBase ? usdc(bondBase) : bond || "0";

  return (
    <div>
      <div className="page py-7">
        <Link href={`/skills/${skillId}`} className="display link text-20">{found.data?.detail.skill.name}</Link>
        <div>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <h1 className="display text-28">Dispute</h1>
            <Stamp s={claim.status} />
          </div>
          <p className="mono mt-1 text-13 text-ink-2">
            claim <Hash v={claimId} head={12} tail={8} /> · {claim.predicate.kind} {claim.predicate.allowlist.length ? claim.predicate.allowlist.join(", ") : "(empty allowlist)"}
          </p>
        </div>
      </div>

      <div className="rule-2 grid gap-x-12 gap-y-12 py-7 lg:grid-cols-2">
        <form className="space-y-8" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <section>
            <div className="label">Stake you are attacking</div>
            <p className="mt-2 leading-none">
              <Money v={stake} unit={false} tone={claim.arcTxHash ? "seal" : "off"} className="text-44" />
              <span className="mono text-16 text-ink-2"> USDC</span>
            </p>
            <p className="mono mt-3 text-12 text-ink-2">staked by <Hash v={claim.stakedBy} /> · human proof <Hash v={claim.humanProofRef} head={8} tail={4} /></p>
            <p className="mono text-12 text-ink-2">{claim.arcTxHash ? <>escrowed on Arc · tx <Hash v={claim.arcTxHash} head={10} tail={6} /> <Ext href={arcTx(claim.arcTxHash)}>Arcscan</Ext></> : "off-chain record: no stake on Arc, a dispute here moves no money"}</p>
          </section>

          <section>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
              <label htmlFor="bundle" className="label">Trace bundle (JSON)</label>
              <div className="ml-auto flex gap-4 text-12">
                <button type="button" className="link" onClick={loadExample}>Load example bundle</button>
                <label className="file link cursor-pointer">Upload file<input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} /></label>
              </div>
            </div>
            <textarea id="bundle" className="field mt-2 h-48 resize-y" value={text} onChange={(e) => setText(e.target.value)} placeholder='{"v":1,"skillId":"…","predicate":{…},"runtime":{…},"input":{…},"events":[…],"violations":[…],"traceHash":"…"}' spellCheck={false} aria-invalid={bundleErr ? "true" : undefined} aria-describedby="bundle-note" />
            <div id="bundle-note" className="mono mt-2 text-12">
              {bundleErr ? <p className="text-seal">{bundleErr}</p> : bundle ? (
                <>
                  <p>traceHashOf(bundle) = <Hash v={computed} head={16} tail={8} /> {hashOk ? <span className="text-ink-2">matches bundle.traceHash</span> : <span className="text-seal">does not match bundle.traceHash</span>}</p>
                  <p>skillId {skillOk ? <span className="text-ink-2">matches the claim</span> : <span className="text-seal">is not this claim&apos;s skill</span>} · runtime {bundle.runtime.node} / {bundle.runtime.image} · {bundle.events.length} events</p>
                  <p className={bundle.violations.length ? "text-seal" : "text-ink-2"}>
                    violations {bundle.violations.length}{bundle.violations.length ? ":" : " — this trace would not break the claim"}
                    {bundle.violations.map((v) => <span key={v.seq} className="block pl-3">#{v.seq} {v.kind} {v.target} <span className="text-ink-2">@ {v.stack.join(" ← ")}</span></span>)}
                  </p>
                </>
              ) : <p className="text-ink-2">Paste a bundle, upload one, or load the example (a real run of cloud-helper reading SIGIL_CANARY_AWS).</p>}
            </div>
          </section>

          <section>
            <label htmlFor="bond" className="label">Counter-bond</label>
            <p className="mt-1 text-12 text-ink-2">USDC, minimum 25% of the stake = {usdc(minBond)}. It goes to the staker if the trace does not reproduce.</p>
            <input id="bond" className="field mt-2 max-w-[240px]" value={bond} onChange={(e) => setBond(e.target.value)} inputMode="decimal" spellCheck={false} autoComplete="off" aria-invalid={bondErr ? "true" : undefined} aria-describedby={bondErr ? "bond-err" : undefined} />
            {bondErr ? <p id="bond-err" className="mt-1 text-12 text-seal">{bondErr}</p> : null}
          </section>

          <section>
            <div className="label">Disputer (Arc address)</div>
            {address ? (
              <p className="mono mt-2 text-13">
                <Hash v={address} head={10} tail={8} />{" "}
                {onArc ? <span className="text-ink-2">on Arc testnet</span> : escrow ? <span className="text-seal">switch to Arc testnet in the top bar</span> : <span className="text-ink-2">off-chain record — chain irrelevant</span>}
              </p>
            ) : escrow ? (
              <p className="mt-2 text-13 text-seal">Connect a wallet (top bar) to post the bond on Arc.</p>
            ) : (
              <>
                <input aria-label="Disputer address" className="field mt-2" value={manualAddr} onChange={(e) => setManualAddr(e.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" aria-invalid={manualAddr && !isAddress(manualAddr) ? "true" : undefined} />
                <p className="mt-1 text-12 text-ink-2">{manualAddr && !isAddress(manualAddr) ? <span className="text-seal">Not an address.</span> : "No wallet connected; this dispute is an off-chain record only."}</p>
              </>
            )}
          </section>

          <section>
            <div className="label">Selfie check</div>
            <div className="mt-2"><HumanCheck identity={by} onProof={setProof} /></div>
          </section>

          <div className="flex flex-wrap items-center gap-4">
            <button type="submit" className="btn btn-seal" disabled={!ready} aria-busy={busy}>
              {busy ? "working…" : done ? "Dispute recorded" : escrow ? `Post ${bondText} USDC bond on Arc` : `Record dispute (${bondText} USDC bond, off-chain)`}
            </button>
            {claim.status !== "LIVE" ? <span className="text-12 text-ink-2">claim is {claim.status} — no new dispute</span> : null}
            {STAKE_ADDRESS && !claim.arcTxHash ? <span className="text-12 text-ink-2">on-chain bond disabled — this claim has no stake on Arc, SigilStake.dispute() would revert &quot;not live&quot;; recorded with the gateway only</span> : null}
          </div>
          <Steps steps={steps} />
        </form>

        <MoneyPanel claimId={claimId} skillId={skillId} />
      </div>
    </div>
  );
}
