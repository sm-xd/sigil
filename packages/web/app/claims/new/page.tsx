"use client";
import { Suspense, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient, useWriteContract } from "wagmi";
import { isAddress } from "viem";
import type { PredicateKind } from "@sigil/shared";
import { ERC20_ABI, SIGIL_STAKE_ABI } from "@/lib/abi";
import { getSkills, postClaim, type WorldProof } from "@/lib/api";
import { STAKE_ADDRESS, USDC_ADDRESS, arcTx } from "@/lib/chain";
import { usdc, usdcToBase } from "@/lib/format";
import { claimIdOf } from "@/lib/hash";
import { HumanCheck } from "@/components/HumanCheck";
import { Ext, Hash, Steps, type Step } from "@/components/Ledger";
import { useArcWallet } from "@/components/Wallet";

/** allow: what the allowlist holds, or null for the kinds the sandbox refuses outright (nothing to allow-list). */
const KINDS: { kind: PredicateKind; hint: string; allow: string | null; placeholder: string }[] = [
  { kind: "NO_ENV_READ_OUTSIDE", hint: "reads no env var outside the allowlist", allow: "env names", placeholder: "LOG_LEVEL" },
  { kind: "NO_NET_EGRESS_OUTSIDE", hint: "opens no connection to a host outside the allowlist", allow: "hostnames", placeholder: "api.example.com" },
  { kind: "NO_FS_READ_OUTSIDE", hint: "reads no path outside the allowlist", allow: "path globs", placeholder: "./**" },
  { kind: "NO_FS_WRITE_OUTSIDE", hint: "writes no path outside the allowlist", allow: "path globs", placeholder: "./**" },
  { kind: "NO_CHILD_PROCESS", hint: "starts no subprocess or worker", allow: null, placeholder: "" },
  { kind: "NO_DYNAMIC_CODE", hint: "runs no eval, new Function or vm code", allow: null, placeholder: "" },
];
const MIN_STAKE = 10n * 10n ** 6n;

export default function Page() { return <Suspense><NewClaim /></Suspense>; }

/** One form row: the label column explains the field; the control sits to the right (max 560px). */
function Field({ id, label, hint, children }: { id: string; label: string; hint: string; children: ReactNode }) {
  return (
    <>
      <div className="md:pt-1.5">
        <label htmlFor={id} id={`${id}-label`} className="label text-ink">{label}</label>
        <p className="mt-1 text-12 text-ink-2">{hint}</p>
      </div>
      <div>{children}</div>
    </>
  );
}

function NewClaim() {
  const router = useRouter();
  const params = useSearchParams();
  const skills = useQuery({ queryKey: ["skills"], queryFn: getSkills });
  const { address, onArc } = useArcWallet();
  const { writeContractAsync } = useWriteContract();
  const pub = usePublicClient();

  const [skillId, setSkillId] = useState(params.get("skill") ?? "");
  const [kind, setKind] = useState<PredicateKind>("NO_ENV_READ_OUTSIDE");
  const [allow, setAllow] = useState("");
  const [stake, setStake] = useState("10");
  const [manualAddr, setManualAddr] = useState("");
  const [proof, setProof] = useState<WorldProof | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);

  const stakedBy = address ?? manualAddr;
  const skill = skills.data?.find((s) => s.id === skillId) ?? (skillId ? undefined : skills.data?.[0]);
  const chosen = skill?.id ?? "";
  let amount: bigint | null = null, amountErr = "";
  try { amount = usdcToBase(stake); if (amount < MIN_STAKE) amountErr = "minimum stake is 10 USDC"; } catch (e) { amountErr = (e as Error).message; }
  const K = KINDS.find((k) => k.kind === kind)!;
  const allowlist = K.allow ? allow.split(",").map((s) => s.trim()).filter(Boolean) : []; // the refused-outright kinds carry no allowlist
  const ready = !!chosen && !!amount && !amountErr && !!proof && isAddress(stakedBy) && (!STAKE_ADDRESS || onArc) && !busy;

  const setStep = (i: number, patch: Partial<Step>) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const submit = async () => {
    if (!ready || !amount || !proof) return;
    setBusy(true);
    const predicate = { kind, allowlist };
    const nonce = Date.now().toString();
    const claimId = claimIdOf(chosen, predicate, stakedBy, nonce);
    const plan: Step[] = [
      { label: `claimId = claimIdOf(skill, predicate, ${stakedBy.slice(0, 8)}…, nonce ${nonce})`, state: "ok", note: <Hash v={claimId} head={12} tail={8} /> },
      { label: STAKE_ADDRESS ? `approve USDC ${usdc(amount)} → SigilStake` : "contract not deployed — recording off-chain (arcTxHash \"\")", state: STAKE_ADDRESS ? "idle" : "ok" },
      { label: `openClaim(claimId, ${usdc(amount)})`, state: "idle" },
      { label: "POST /claims", state: "idle" },
    ];
    setSteps(plan);
    let arcTxHash = "", cur = 1;
    const run = (i: number) => { cur = i; setStep(i, { state: "run" }); };
    try {
      if (STAKE_ADDRESS) {
        run(1);
        const a = await writeContractAsync({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "approve", args: [STAKE_ADDRESS, amount] });
        await pub?.waitForTransactionReceipt({ hash: a });
        setStep(1, { state: "ok", note: <Ext href={arcTx(a)}>tx</Ext> });
        run(2);
        arcTxHash = await writeContractAsync({ address: STAKE_ADDRESS, abi: SIGIL_STAKE_ABI, functionName: "openClaim", args: [claimId, amount] });
        await pub?.waitForTransactionReceipt({ hash: arcTxHash as `0x${string}` });
        setStep(2, { state: "ok", note: <Ext href={arcTx(arcTxHash)}>tx</Ext> });
      } else {
        setStep(2, { state: "ok", note: "skipped" });
      }
      run(3);
      const claim = await postClaim({ skillId: chosen, predicate, stakeAmount: amount.toString(), stakedBy, arcTxHash, worldProof: proof, nonce });
      setStep(3, { state: "ok", note: `${claim.status}${claim.hcsTopicId ? ` · topic ${claim.hcsTopicId}` : ""}` });
      router.push(`/skills/${chosen}`);
    } catch (e) {
      setStep(cur, { state: "err", note: (e as Error).message });
      setBusy(false);
    }
  };


  return (
    <div>
      <div className="page py-7">
        <h1 className="display text-20">Claim</h1>
        <div>
          <h2 className="display text-28">Open a claim</h2>
          <p className="mt-2 max-w-[560px] text-14 text-ink-2">You stake USDC that this skill satisfies a machine-testable predicate. Anyone who produces a sandbox trace that breaks it takes your stake.</p>
        </div>
      </div>

      <form className="page rule-2 gap-y-6 py-7 md:grid-cols-[200px_minmax(0,560px)] md:gap-y-8" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field id="skill" label="Skill" hint="The registered skill this claim is about. Its source is on HCS-1; the id is the sha256 of the bundle.">
          <select id="skill" className="field" value={chosen} onChange={(e) => setSkillId(e.target.value)}>
            {!skills.data?.length ? <option value="">{skills.isLoading ? "loading…" : "no skills — run pnpm seed"}</option> : null}
            {skills.data?.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.id.slice(0, 12)}… ({usdc(s.totalStaked)} staked)</option>)}
          </select>
        </Field>

        <div className="md:pt-1.5">
          <div id="kind-label" className="label text-ink">Predicate</div>
          <p className="mt-1 text-12 text-ink-2">What the stake says the skill never does. The sandbox records every env, file, network, subprocess and dynamic-code event; one violation in a reproducible trace breaks the claim.</p>
        </div>
        <div role="radiogroup" aria-labelledby="kind-label">
          {KINDS.map((k) => (
            <label key={k.kind} className="flex cursor-pointer items-baseline gap-2 py-1 text-13">
              <input type="radio" name="kind" value={k.kind} checked={kind === k.kind} onChange={() => setKind(k.kind)} className="accent-ink" />
              <span className="mono">{k.kind}</span><span className="text-ink-2">{k.hint}</span>
            </label>
          ))}
        </div>

        <Field id="allow" label="Allowlist" hint={K.allow ? `Comma-separated ${K.allow} the predicate permits. Empty means the skill may touch nothing of this kind.` : "None for this rule. The sandbox refuses every subprocess and every eval, so the claim is simply that the skill never tries."}>
          {K.allow ? <input id="allow" className="field" value={allow} onChange={(e) => setAllow(e.target.value)} placeholder={K.placeholder} spellCheck={false} autoComplete="off" /> : <p id="allow" className="mono text-13 text-ink-3">no allowlist</p>}
        </Field>

        <Field id="stake" label="Stake" hint="USDC locked in SigilStake on Arc, minimum 10.000000. A sustained dispute pays it, with the bond, to the disputer.">
          <input id="stake" className="field" value={stake} onChange={(e) => setStake(e.target.value)} inputMode="decimal" spellCheck={false} autoComplete="off" aria-invalid={amountErr ? "true" : undefined} aria-describedby="stake-note" />
          <p id="stake-note" className={`mono mt-1 text-12 ${amountErr ? "text-seal" : "text-ink-2"}`}>{amountErr || (amount ? `${amount} base units` : "")}</p>
        </Field>

        <Field id="staker" label="Staker" hint="The Arc address that signs approve and openClaim and holds the claim.">
          {address ? (
            <p id="staker" className="mono text-13">
              <Hash v={address} head={10} tail={8} />{" "}
              {onArc ? <span className="text-ink-2">on Arc testnet</span> : STAKE_ADDRESS ? <span className="text-seal">switch to Arc testnet in the top bar</span> : <span className="text-ink-2">off-chain record — chain irrelevant</span>}
            </p>
          ) : STAKE_ADDRESS ? (
            <p id="staker" className="text-13 text-seal">Connect a wallet (top bar) to escrow USDC on Arc.</p>
          ) : (
            <>
              <input id="staker" className="field" value={manualAddr} onChange={(e) => setManualAddr(e.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" aria-invalid={manualAddr && !isAddress(manualAddr) ? "true" : undefined} />
              <p className="mt-1 text-12 text-ink-2">{manualAddr && !isAddress(manualAddr) ? <span className="text-seal">Not an address.</span> : "No wallet connected; the contract is undeployed so this is an off-chain record only."}</p>
            </>
          )}
        </Field>

        <div className="md:pt-1.5">
          <div className="label text-ink">Selfie check</div>
          <p className="mt-1 text-12 text-ink-2">One human per side. The gateway refuses a dispute whose nullifier matches the claim&apos;s.</p>
        </div>
        <div><HumanCheck identity={stakedBy} onProof={setProof} /></div>

        <div className="hidden md:block" />
        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" className="btn btn-seal" disabled={!ready} aria-busy={busy}>
            {busy ? "working…" : STAKE_ADDRESS ? `Stake ${amount ? usdc(amount) : stake || "0"} USDC on Arc` : `Record claim (${amount ? usdc(amount) : stake || "0"} USDC, off-chain)`}
          </button>
          {!STAKE_ADDRESS ? <span className="text-12 text-ink-2">contract undeployed — no USDC moves</span> : null}
        </div>

        {steps.length ? <div className="md:col-span-2"><Steps steps={steps} /></div> : null}
      </form>
    </div>
  );
}
