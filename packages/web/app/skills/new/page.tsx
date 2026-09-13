"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { SkillManifest, SkillSource } from "@sigil/shared";
import { postSkill } from "@/lib/api";
import { skillIdOf } from "@/lib/hash";
import { Ext, Hash, Steps, type Step } from "@/components/Ledger";
import { useArcWallet } from "@/components/Wallet";
import { hashscanTopic } from "@/lib/chain";

/** One bundled example, served by app/api/examples from the repo's examples/ folder (the same folders `pnpm register` reads). */
interface Example { name: string; author: string; description: string; manifest: SkillManifest; files: Record<string, string> }
const getExamples = () => fetch("/api/examples").then((r) => r.json() as Promise<Example[]>);

const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

function Field({ id, label, hint, children }: { id: string; label: string; hint: string; children: ReactNode }) {
  return (
    <>
      <div className="md:pt-1.5">
        <label htmlFor={id} className="label text-ink">{label}</label>
        <p className="mt-1 text-12 text-ink-2">{hint}</p>
      </div>
      <div>{children}</div>
    </>
  );
}

export default function NewSkill() {
  const { address } = useArcWallet();
  const examples = useQuery({ queryKey: ["examples"], queryFn: getExamples });

  const [name, setName] = useState("");
  const [author, setAuthor] = useState("");
  const [entrypoint, setEntrypoint] = useState("index.js");
  const [declaredEnv, setDeclaredEnv] = useState("");
  const [declaredHosts, setDeclaredHosts] = useState("");
  const [code, setCode] = useState("");
  const [extra, setExtra] = useState<Record<string, string>>({}); // an example's other files, carried along unchanged
  const [steps, setSteps] = useState<Step[]>([]);
  const [done, setDone] = useState<{ id: string; created: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const by = author || address || "";
  const source: SkillSource = { entrypoint, files: { ...extra, [entrypoint]: code } };
  const id = code && entrypoint ? skillIdOf(source) : "";
  const ready = !!name.trim() && !!entrypoint.trim() && !!code.trim() && !!by && !busy && !done;

  const load = (ex: Example) => {
    setName(ex.name); setAuthor(ex.author); setEntrypoint(ex.manifest.entrypoint);
    setDeclaredEnv(ex.manifest.declaredEnv.join(", ")); setDeclaredHosts(ex.manifest.declaredHosts.join(", "));
    const { [ex.manifest.entrypoint]: main = "", ...rest } = ex.files;
    setCode(main); setExtra(rest); setSteps([]); setDone(null);
  };

  const setStep = (i: number, patch: Partial<Step>) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    const manifest: SkillManifest = { entrypoint, declaredEnv: csv(declaredEnv), declaredHosts: csv(declaredHosts) };
    setSteps([
      { label: "id = sha256(canonical source)", state: "ok", note: <Hash v={id} head={12} tail={8} /> },
      { label: "POST /skills → pin the source bundle on Hedera (HCS-1)", state: "run" },
      { label: "SKILL_REGISTERED on the registry topic", state: "idle" },
    ]);
    try {
      const r = await postSkill({ name: name.trim(), author: by, manifest, source });
      setStep(1, { state: "ok", note: r.skill.sourceUri.startsWith("hcs://") ? <Ext href={hashscanTopic(r.skill.sourceUri.replace("hcs://1/", ""))}>{r.skill.sourceUri}</Ext> : r.skill.sourceUri });
      setStep(2, { state: "ok", note: r.created ? "announced · listed in the registry" : "already registered: same files, same id" });
      setDone({ id: r.skill.id, created: r.created });
    } catch (e) {
      setStep(1, { state: "err", note: (e as Error).message });
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page py-7">
        <h1 className="display text-20">Skill</h1>
        <div>
          <h2 className="display text-28">Register a skill</h2>
          <p className="mt-2 max-w-[560px] text-14 text-ink-2">Listing is free and needs no wallet. The gateway hashes the source into the skill&apos;s id, pins the bundle on Hedera, and announces it. Money enters only when someone opens a claim on it.</p>
        </div>
      </div>

      <form className="page rule-2 gap-y-6 py-7 md:grid-cols-[200px_minmax(0,560px)] md:gap-y-8" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field id="example" label="Start from an example" hint="The small skills that ship with the repo. Two touch nothing; the other three each break one rule on purpose, so there is something to stake on either way.">
          <select id="example" className="field" defaultValue="" onChange={(e) => { const ex = examples.data?.find((x) => x.name === e.target.value); if (ex) load(ex); }}>
            <option value="">{examples.isLoading ? "loading…" : "write your own, or pick one"}</option>
            {examples.data?.map((ex) => <option key={ex.name} value={ex.name}>{ex.name}{ex.description ? ` — ${ex.description}` : ""}</option>)}
          </select>
        </Field>

        <Field id="name" label="Name" hint="Shown in the registry. The id is derived from the code, not the name.">
          <input id="name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="word-count" spellCheck={false} autoComplete="off" />
        </Field>

        <Field id="author" label="Author" hint="The address that published it. Prefilled from the connected wallet; any string the gateway can show is accepted.">
          <input id="author" className="field mono" value={by} onChange={(e) => setAuthor(e.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" />
        </Field>

        <Field id="entrypoint" label="Entrypoint" hint="The file the sandbox runs with `node`. It reads argv and stdin, writes stdout.">
          <input id="entrypoint" className="field mono" value={entrypoint} onChange={(e) => setEntrypoint(e.target.value)} spellCheck={false} autoComplete="off" />
        </Field>

        <Field id="code" label="Source" hint="Plain Node.js, CommonJS. This is what gets hashed, pinned and sold over x402.">
          <textarea id="code" className="field mono" rows={14} value={code} onChange={(e) => setCode(e.target.value)} placeholder={'process.stdin.on("data", (c) => process.stdout.write(c));'} spellCheck={false} />
          {Object.keys(extra).length ? <p className="mono mt-1 text-12 text-ink-2">+ {Object.keys(extra).join(", ")} from the example, included unchanged</p> : null}
          {id ? <p className="mono mt-1 text-12 text-ink-2">id <Hash v={id} head={12} tail={8} /></p> : null}
        </Field>

        <Field id="env" label="Declared env" hint="Comma-separated variables the skill admits it reads. Informational: a claim's allowlist is what someone bets on.">
          <input id="env" className="field mono" value={declaredEnv} onChange={(e) => setDeclaredEnv(e.target.value)} placeholder="LOG_LEVEL" spellCheck={false} autoComplete="off" />
        </Field>

        <Field id="hosts" label="Declared hosts" hint="Comma-separated hosts the skill admits it contacts.">
          <input id="hosts" className="field mono" value={declaredHosts} onChange={(e) => setDeclaredHosts(e.target.value)} placeholder="api.example.com" spellCheck={false} autoComplete="off" />
        </Field>

        <div className="hidden md:block" />
        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" className="btn btn-seal" disabled={!ready} aria-busy={busy}>{busy && !done ? "registering…" : "Register"}</button>
          {done ? (
            <>
              <Link href={`/skills/${done.id}`} className="link text-14">View skill</Link>
              <Link href={`/claims/new?skill=${done.id}`} className="link text-14 text-seal">Open a claim on it</Link>
            </>
          ) : null}
        </div>

        {steps.length ? <div className="md:col-span-2"><Steps steps={steps} /></div> : null}
      </form>
    </div>
  );
}
