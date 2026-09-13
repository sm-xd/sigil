"use client";
// The demo: two numbers — STAKE and COUNTER-BOND — and the pot moving under the winner when the claim resolves.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePublicClient, useWriteContract } from "wagmi";
import { SIGIL_STAKE_ABI } from "@/lib/abi";
import { getSkill, postResolve, postResolved } from "@/lib/api";
import { STAKE_ADDRESS, arcTx } from "@/lib/chain";
import { short, usdc } from "@/lib/format";
import { Ext, Hash } from "./Ledger";
import { Money } from "./Money";
import { Stamp } from "./Stamp";
import { useArcWallet } from "./Wallet";

export function MoneyPanel({ claimId, skillId }: { claimId: string; skillId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["skill", skillId], queryFn: () => getSkill(skillId), refetchInterval: 3_000 });
  const claim = q.data?.claims.find((c) => c.id === claimId);
  const dispute = q.data?.disputes.find((d) => d.claimId === claimId);
  const resolution = q.data?.resolutions.find((r) => r.claimId === claimId);
  const { onArc } = useArcWallet();
  const { writeContractAsync } = useWriteContract();
  const pub = usePublicClient();
  const [verdict, setVerdict] = useState<{ reproduced: boolean; observedHash: string; verdictTxHash: string } | null>(null);
  const [busy, setBusy] = useState<"resolve" | "settle" | null>(null);
  const [err, setErr] = useState("");

  if (!claim) return <p className="mono text-13 text-ink-3">{q.isLoading ? "Loading the money panel…" : "Claim not found."}</p>;

  const stake = BigInt(claim.stakeAmount);
  const bond = BigInt(dispute?.counterBond ?? "0");
  const escrow = claim.arcTxHash ? STAKE_ADDRESS : ""; // contract holding the stake, or "" for an off-chain record (resolve() there would revert)
  const pot = stake + bond;
  const winnerIsDisputer = resolution ? resolution.outcome === "CLAIM_BROKEN" : null;
  const refresh = () => qc.invalidateQueries({ queryKey: ["skill", skillId] });

  const runResolver = async () => {
    setErr(""); setBusy("resolve");
    try { setVerdict(await postResolve(claimId)); await refresh(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  };
  const settle = async () => {
    setErr(""); setBusy("settle");
    try {
      let arcTxHash = "";
      if (escrow) {
        if (!onArc) throw new Error("connect a wallet on Arc testnet to call resolve()");
        arcTxHash = await writeContractAsync({ address: escrow, abi: SIGIL_STAKE_ABI, functionName: "resolve", args: [claimId as `0x${string}`] });
        await pub?.waitForTransactionReceipt({ hash: arcTxHash as `0x${string}` });
      }
      await postResolved(claimId, arcTxHash);
      await refresh();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  };

  const col = (side: "staker" | "disputer") => {
    const isStaker = side === "staker";
    const mine = isStaker ? stake : bond;
    const tx = isStaker ? claim.arcTxHash : dispute?.arcTxHash;
    const won = winnerIsDisputer === null ? null : (side === "disputer") === winnerIsDisputer;
    const tone = won === false || (!isStaker && !dispute) ? "off" : won ? "ink" : tx ? "seal" : "off";
    return (
      <div className={isStaker ? "pr-4" : "border-l border-rule pl-4"}>
        <div className="label">{side}</div>
        <p className="mt-2 leading-none">
          <Money v={won ? pot : won === false ? 0n : mine} unit={false} tone={tone} className={`text-20 md:text-32 ${won === false ? "line-through" : ""}`} />
          <span className="mono text-12 text-ink-2"> USDC</span>
        </p>
        <p className="mono mt-2 text-12 text-ink-2">
          {isStaker ? "stake by " : "bond by "}
          {isStaker ? <Hash v={claim.stakedBy} /> : dispute ? <Hash v={dispute.by} /> : "no dispute yet"}
        </p>
        {isStaker || dispute ? (
          <p className="mono text-12 text-ink-2">
            {tx ? <>{isStaker ? "escrowed" : "bonded"} on Arc · tx <Hash v={tx} head={10} tail={6} /> <Ext href={arcTx(tx)}>Arcscan</Ext></> : isStaker ? "off-chain record: no stake on Arc, a dispute here moves no money" : "off-chain record: no bond on Arc"}
          </p>
        ) : null}
        {won ? <p className="mono text-12 text-ink-2">+{usdc(isStaker ? bond : stake)} from the other side</p> : null}
      </div>
    );
  };

  return (
    <section aria-label="Money">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 border-b border-rule-2 pb-2">
        <h2 className="display text-20">Money</h2>
        <Stamp s={claim.status} />
      </div>
      <div className="grid grid-cols-2 py-4">{col("staker")}{col("disputer")}</div>
      <div className="rule relative overflow-hidden py-3">
        <p className="pot mono whitespace-nowrap text-13" data-side={winnerIsDisputer === null ? "none" : winnerIsDisputer ? "disputer" : "staker"}>
          <span className="text-ink-2">pot</span> {usdc(pot)} USDC
          <span className="text-ink-2">{resolution ? ` → ${winnerIsDisputer ? "disputer" : "staker"}` : claim.arcTxHash ? " · in escrow on Arc" : " · off-chain record"}</span>
        </p>
      </div>
      {resolution ? (
        <div className="after-move rule mono py-3 text-12">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Stamp s={resolution.outcome} />
            <span><span className="text-ink-2">reason</span> {resolution.reason}</span>
            <span><span className="text-ink-2">winner</span> <Hash v={resolution.winner} head={10} tail={6} /></span>
          </div>
          <p className="mt-1">
            <span className="text-ink-2">settlement</span> {resolution.arcTxHash ? <Ext href={arcTx(resolution.arcTxHash)}>{short(resolution.arcTxHash, 10, 6)} on Arcscan</Ext> : "off-chain record"}
            {resolution.hcsSequence ? <span className="text-ink-2"> · HCS seq {resolution.hcsSequence}</span> : null}
          </p>
        </div>
      ) : null}
      <div className="rule flex flex-wrap items-center gap-3 py-3">
        <button type="button" className="btn" disabled={!dispute || !!resolution || busy !== null} aria-busy={busy === "resolve"} onClick={runResolver}>{busy === "resolve" ? "re-running trace…" : "Run resolver"}</button>
        <button type="button" className="btn btn-seal" disabled={!dispute || !!resolution || busy !== null || (!!escrow && !onArc)} aria-busy={busy === "settle"} onClick={settle} title={escrow ? "resolve(claimId) from your wallet, then record" : "off-chain: records the outcome without an Arc tx"}>
          {busy === "settle" ? "settling…" : escrow ? "Settle on Arc" : "Settle (off-chain)"}
        </button>
        {!dispute ? <span className="text-12 text-ink-2">dispute first</span> : null}
        {err ? <span className="text-12 text-seal">{err}</span> : null}
      </div>
      {verdict ? (
        <dl className="mono grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-12">
          <dt className="text-ink-2">reproduced</dt><dd className={verdict.reproduced ? "text-seal" : ""}>{String(verdict.reproduced)}</dd>
          <dt className="text-ink-2">observedHash</dt><dd><Hash v={verdict.observedHash} head={16} tail={8} /></dd>
          <dt className="text-ink-2">verdictTx</dt><dd>{verdict.verdictTxHash ? <Ext href={arcTx(verdict.verdictTxHash)}>{short(verdict.verdictTxHash, 10, 6)}</Ext> : "not posted (resolver undeployed)"}</dd>
        </dl>
      ) : null}
    </section>
  );
}
