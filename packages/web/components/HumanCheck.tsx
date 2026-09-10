"use client";
// Selfie Check gate used by "Open a claim" and "Dispute". Yields the worldProof the gateway verifies.
// mock:    { mock: true, nullifier } — clearly labelled stub until World Sandbox access lands.
// sandbox: POST /world/rp-context -> IDKitRequestWidget(selfieCheckLegacy) -> full IDKit result as-is.
// Prop names below come from node_modules/@worldcoin/idkit/dist/index.d.ts (see WORLD-NOTES.md).
import dynamic from "next/dynamic";
import { useState } from "react";
import { keccak256, stringToBytes } from "viem";
import { selfieCheckLegacy, type IDKitResult } from "@worldcoin/idkit";
import { postRpContext, type RpContext, type WorldProof } from "@/lib/api";
import { WORLD_ACTION_ID, WORLD_APP_ID, WORLD_MODE } from "@/lib/chain";
import { Hash } from "./Ledger";

// idkit-core loads WASM and talks to window; keep it off the server render.
const IDKitRequestWidget = dynamic(() => import("@worldcoin/idkit").then((m) => m.IDKitRequestWidget), { ssr: false });

export function HumanCheck({ identity, onProof }: { identity: string; onProof: (proof: WorldProof | null) => void }) {
  const [proof, setProof] = useState<WorldProof | null>(null);
  const [rp, setRp] = useState<RpContext | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (p: WorldProof | null) => { setProof(p); onProof(p); };

  if (proof) {
    const nullifier = "mock" in proof ? String(proof.nullifier) : String((proof as { responses?: { nullifier?: string }[] }).responses?.[0]?.nullifier ?? "?");
    return (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-13">
        <span className="font-medium">{WORLD_MODE === "mock" ? "Mock Selfie Check" : "Selfie Check"} verified</span>
        <span className="mono text-ink-2">nullifier <Hash v={nullifier} head={10} tail={6} /></span>
        <button type="button" className="link text-12 text-ink-2" onClick={() => set(null)}>reset</button>
      </div>
    );
  }

  if (WORLD_MODE === "mock") {
    return (
      <div>
        <button
          type="button"
          className="btn border-dashed"
          onClick={() => set({ mock: true, nullifier: keccak256(stringToBytes(identity || crypto.randomUUID())) })}
        >
          Mock Selfie Check (World Sandbox access pending)
        </button>
        <p className="mt-2 text-12 text-ink-2">
          nullifier = keccak256({identity ? "connected address" : "random id"}). The gateway still refuses a dispute whose nullifier matches the claim&apos;s.
        </p>
      </div>
    );
  }

  const start = async () => {
    setErr(""); setBusy(true);
    try { setRp(await postRpContext(WORLD_ACTION_ID)); setOpen(true); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <button type="button" className="btn" disabled={busy || !WORLD_APP_ID} aria-busy={busy} onClick={start}>
        {busy ? "requesting rp_context…" : "Selfie Check (World sandbox)"}
      </button>
      {!WORLD_APP_ID ? <p className="mt-2 text-12 text-seal">NEXT_PUBLIC_WORLD_APP_ID is empty</p> : null}
      {err ? <p className="mt-2 text-12 text-seal">{err}</p> : null}
      {rp ? (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={WORLD_APP_ID as `app_${string}`}
          action={WORLD_ACTION_ID}
          rp_context={rp}
          allow_legacy_proofs={true} // selfieCheckLegacy only returns World ID 3.0 proofs
          environment="sandbox"
          preset={selfieCheckLegacy({ signal: identity || undefined })}
          onSuccess={(result: IDKitResult) => set(result as unknown as WorldProof)}
          onError={(code) => setErr(`IDKit: ${code}`)}
        />
      ) : null}
    </div>
  );
}
