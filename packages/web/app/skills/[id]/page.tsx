"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getAccess, getSkill, requestSource } from "@/lib/api";
import { arcTx, hashscanAccount, hashscanNft, hashscanToken, hashscanTopic, hashscanTx, sourceLink } from "@/lib/chain";
import { ageSince, hbar, usdc, usdcToBase } from "@/lib/format";
import { Ext, Hash, Ledger } from "@/components/Ledger";
import { Money } from "@/components/Money";
import { Stamp } from "@/components/Stamp";

/** `0.001000 USDC` or `0.00100000 HBAR` from an x402 leg: asset 0.0.0 is HBAR in tinybar, anything else the HTS USDC token in 6-dp base units. */
function Leg({ amount, asset }: { amount: string; asset: string }) {
  const h = asset === "0.0.0";
  return <span className="mono">{h ? hbar(amount) : usdc(amount)}<span className="text-ink-2"> {h ? "HBAR" : "USDC"}</span></span>;
}

/** What a request costs, the paywall itself fetched from this browser, who holds a licence and who paid. Refetches /access every 10 s, silently. */
function Access({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["access", id], queryFn: () => getAccess(id), refetchInterval: 10_000 });
  const src = useMutation({ mutationFn: () => requestSource(id) });
  const a = q.data;
  if (!a) return <p className={`mono text-13 ${q.isError ? "text-seal" : "text-ink-3"}`}>{q.isError ? (q.error as Error).message : "Loading the price…"}</p>;
  const usdcLeg = a.price.accepts.find((l) => l.asset !== "0.0.0");
  const hbarLeg = a.price.accepts.find((l) => l.asset === "0.0.0");
  const paywall = src.data?.status === 402 ? src.data.paywall : null;
  return (
    <div>
      <h3 className="display text-20">Use this skill</h3>
      <p className="mt-2 text-14">
        <Money v={usdcToBase(a.price.perKbUsdc)} /> <span className="text-ink-2">per KB · this source is</span> <span className="mono">{a.price.kb} KB</span> <span className="text-ink-2">→</span>{" "}
        {usdcLeg ? <Leg amount={usdcLeg.amount} asset={usdcLeg.asset} /> : null}
        {usdcLeg && hbarLeg ? <span className="text-ink-2"> or </span> : null}
        {hbarLeg ? <Leg amount={hbarLeg.amount} asset={hbarLeg.asset} /> : null}{" "}
        <span className="text-ink-2">per request, settled by Blocky402 on</span> <span className="mono">{a.network}</span><span className="text-ink-2">, paid to</span>{" "}
        <span className="mono"><Ext href={hashscanAccount(a.payTo)}>{a.payTo}</Ext></span>
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" className="btn" disabled={src.isPending} aria-busy={src.isPending} onClick={() => src.mutate()}>{src.isPending ? "requesting…" : "Request the source"}</button>
        <span className="mono text-12 text-ink-2">GET /skills/{"{id}"}/source · no licence header, no payment</span>
      </div>
      {src.error ? <p className="mono mt-2 text-13 text-seal">{(src.error as Error).message}</p> : null}
      {paywall ? (
        <div className="mt-4">
          <p className="text-14"><span className="mono text-seal">402 Payment Required</span><span className="text-ink-2"> · the gateway served no source, because no payment came with the request. It wants one of these first:</span></p>
          <div className="mt-2">
            <Ledger>
              <thead><tr><th>asset</th><th className="num">amount</th><th>pay to</th><th>network</th></tr></thead>
              <tbody>
                {paywall.accepts.map((l) => (
                  <tr key={l.asset}>
                    <td className="mono">{l.asset === "0.0.0" ? "HBAR" : <>USDC <span className="text-ink-2">· HTS {l.asset}</span></>}</td>
                    <td className="num"><Leg amount={l.amount} asset={l.asset} /><div className="text-12 text-ink-3">{l.amount} {l.asset === "0.0.0" ? "tinybar" : "base units"}</div></td>
                    <td className="mono"><Ext href={hashscanAccount(l.payTo)}>{l.payTo}</Ext></td>
                    <td className="mono">{l.network}</td>
                  </tr>
                ))}
              </tbody>
            </Ledger>
          </div>
          <p className="mt-3 text-13 text-ink-2">This is the paywall an agent sees. A browser cannot pay it; an agent signs a partial Hedera transaction and Blocky402 submits it. To get the source yourself, run the first command under "Use it from a terminal" below: it pays this once and saves the files.</p>
        </div>
      ) : src.data?.status === 200 ? (
        <p className="mono mt-2 text-13">200 · {src.data.bytes} bytes of source. <span className="text-ink-2">This browser holds a licence, so the gate let it through free.</span></p>
      ) : null}

      <div className="mt-8">
        <p className="label">Licence holders <span className="mono">{a.licences.length}</span></p>
        {!a.licences.length ? <p className="mt-2 text-13 text-ink-2">No licence minted yet.</p> : (
          <div className="mt-2">
            <Ledger>
              <thead><tr><th>serial</th><th>account</th></tr></thead>
              <tbody>
                {a.licences.map((l) => (
                  <tr key={l.serial}>
                    <td className="mono"><Ext href={hashscanNft(a.licenseToken, l.serial)}>#{l.serial}</Ext></td>
                    <td className="mono"><Ext href={hashscanAccount(l.account)}>{l.account}</Ext></td>
                  </tr>
                ))}
              </tbody>
            </Ledger>
          </div>
        )}
        <p className="mt-2 text-13 text-ink-2">A licence is minted to the payer on settlement; holders read the source free.</p>
      </div>

      <div className="mt-8">
        <p className="label">Payments <span className="mono">{a.payments.length}</span></p>
        {!a.payments.length ? <p className="mt-2 text-13 text-ink-2">No paid request on this index yet. Run the agent below.</p> : (
          <div className="mt-2">
            <Ledger>
              <thead><tr><th>when</th><th>payer</th><th className="num">amount</th><th className="num">size</th><th>settlement</th><th>licence</th></tr></thead>
              <tbody>
                {a.payments.map((p) => (
                  <tr key={p.txId}>
                    <td className="mono whitespace-nowrap">{ageSince(p.ts)} ago</td>
                    <td className="mono"><Ext href={hashscanAccount(p.payer)}>{p.payer}</Ext></td>
                    <td className="num"><Leg amount={p.amount} asset={p.asset} /></td>
                    <td className="num">{(p.bytes / 1024).toFixed(1)} KB <span className="text-ink-3">· {p.bytes} B</span></td>
                    <td><Hash v={p.txId} head={12} tail={8} /><div><Ext href={hashscanTx(p.txId)}>HashScan</Ext></div></td>
                    <td className="mono">{p.licenseSerial != null ? <Ext href={hashscanNft(a.licenseToken, p.licenseSerial)}>#{p.licenseSerial}</Ext> : <span className="text-ink-3">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </Ledger>
          </div>
        )}
      </div>

      <div className="mt-8">
        <p className="label">For agents and developers</p>
        <p className="mt-2 text-13 text-ink-2">
          Registering, claiming, probing, disputing and settling all happen in this app. Buying does not: a browser wallet cannot pay x402 on Hedera, so the buyer is an agent.
          From the repo, <span className="mono">buy</span> pays the 402 once, takes the licence and saves the files under <span className="mono">downloads/</span>;{" "}
          <span className="mono">e2e</span> is the full agent: it pays, probes the skill in the sandbox and disputes what it finds. Click a line to copy it.
        </p>
        {/* head=Infinity: the whole command, still copy-on-click */}
        <div className="mt-2 overflow-x-auto"><Hash v={a.howTo.buy} head={Infinity} className="text-13" /></div>
        <div className="mt-1 overflow-x-auto"><Hash v={a.howTo.agent} head={Infinity} className="text-13" /></div>
        <div className="mt-1 overflow-x-auto text-ink-2"><Hash v={a.howTo.curl} head={Infinity} className="text-12" /></div>
      </div>
    </div>
  );
}

export default function SkillDetail() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ["skill", id], queryFn: () => getSkill(id) });
  if (q.isLoading || q.isError || !q.data) {
    return (
      <div className="page py-7">
        <Link href="/registry" className="display link text-20">Registry</Link>
        <p className={`mono text-13 ${q.isLoading ? "text-ink-3" : "text-seal"}`}>{q.isLoading ? "Loading the skill…" : (q.error as Error)?.message ?? "Skill not found."}</p>
      </div>
    );
  }
  const { skill, claims, disputes, resolutions, license } = q.data;
  const src = sourceLink(skill.sourceUri);
  const live = claims.filter((c) => c.status === "LIVE" || c.status === "DISPUTED");
  const atRisk = live.filter((c) => c.arcTxHash).reduce((a, c) => a + BigInt(c.stakeAmount), 0n);
  const recorded = live.filter((c) => !c.arcTxHash).reduce((a, c) => a + BigInt(c.stakeAmount), 0n);
  const status = disputes.some((d) => d.status === "SUSTAINED") ? "BROKEN" : atRisk > 0n ? "LIVE" : recorded > 0n ? "RECORDED" : "";
  const firstLive = claims.find((c) => c.status === "LIVE");

  return (
    <div>
      <div className="page py-7">
        <Link href="/registry" className="display link text-20">Registry</Link>
        <div>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <h1 className="display text-28">{skill.name}</h1>
            {status ? <Stamp s={status} /> : <span className="text-12 text-ink-3">no capital at risk</span>}
          </div>
          {skill.description ? <p className="mt-1 max-w-[560px] text-14 text-ink-2">{skill.description}</p> : null}
          <p className="mono mt-1 text-13 text-ink-2"><Hash v={skill.id} head={10} tail={8} /></p>
          <p className="mono mt-3 text-14">
            <Money v={atRisk} tone={atRisk > 0n ? "seal" : "off"} /> <span className="text-ink-2">escrowed on Arc</span>
            {recorded > 0n ? <span className="text-ink-3"> · +{usdc(recorded)} recorded off-chain</span> : null}
          </p>
        </div>
      </div>

      <section className="page rule-2 py-7">
        <h2 className="display text-20">Manifest</h2>
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2 text-13">
          <dt className="label pt-0.5">author</dt><dd><Hash v={skill.author} head={8} tail={6} /></dd>
          <dt className="label pt-0.5">entrypoint</dt><dd className="mono">{skill.manifest.entrypoint}</dd>
          <dt className="label pt-0.5">source</dt><dd className="mono">{src ? <Ext href={src}>{skill.sourceUri}</Ext> : skill.sourceUri}</dd>
          <dt className="label pt-0.5">registered</dt><dd className="mono">{ageSince(skill.registeredAt)} ago</dd>
          <dt className="label pt-0.5">declared env</dt><dd className="mono">{skill.manifest.declaredEnv.length ? skill.manifest.declaredEnv.join(", ") : <span className="text-ink-3">none</span>}</dd>
          <dt className="label pt-0.5">declared hosts</dt><dd className="mono">{skill.manifest.declaredHosts.length ? skill.manifest.declaredHosts.join(", ") : <span className="text-ink-3">none</span>}</dd>
          <dt className="label pt-0.5">license NFT (HTS)</dt><dd className="mono">{license.tokenId ? <Ext href={hashscanToken(license.tokenId)}>{license.tokenId}</Ext> : <span className="text-ink-3">not configured</span>}</dd>
        </dl>
      </section>

      <section className="page rule-2 py-7">
        <h2 className="display text-20">Access</h2>
        <Access id={skill.id} />
      </section>

      <section className="page rule-2 py-7">
        <h2 className="display text-20">Claims <span className="mono text-13 text-ink-2">{claims.length}</span></h2>
        <div>
          <div className="flex justify-end pb-3"><Link href={`/claims/new?skill=${skill.id}`} className="act">Open a claim</Link></div>
          {!claims.length ? <p className="text-13 text-ink-2">No claims on this skill yet.</p> : (
            <Ledger>
              <thead><tr><th>predicate</th><th className="num">stake, USDC</th><th>escrow</th><th>age</th><th>status</th><th>staker / human proof</th><th>HCS topic</th><th></th></tr></thead>
              <tbody>
                {claims.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">
                      <div className="text-12">{c.predicate.kind}</div>
                      <div className="text-12 text-ink-2">{c.predicate.allowlist.length ? c.predicate.allowlist.join(", ") : "empty allowlist"}</div>
                      <div className="text-12 text-ink-2"><Hash v={c.id} head={8} tail={6} /></div>
                    </td>
                    <td className="num"><Money v={c.stakeAmount} tone={c.arcTxHash ? "seal" : "off"} unit={false} /></td>
                    <td>{c.arcTxHash ? <><Hash v={c.arcTxHash} head={8} tail={6} /><div><Ext href={arcTx(c.arcTxHash)}>Arcscan</Ext></div></> : <span className="text-12 text-ink-3">off-chain record</span>}</td>
                    <td className="mono whitespace-nowrap">{ageSince(c.createdAt)}</td>
                    <td><Stamp s={c.status} /></td>
                    <td><Hash v={c.stakedBy} /><div className="text-12 text-ink-2"><Hash v={c.humanProofRef} head={8} tail={4} /></div></td>
                    <td className="mono">{c.hcsTopicId ? <Ext href={hashscanTopic(c.hcsTopicId)}>{c.hcsTopicId}</Ext> : <span className="text-ink-3">—</span>}</td>
                    <td>{c.status === "LIVE" ? <Link href={`/claims/${c.id}/dispute?skill=${skill.id}`} className="act">Dispute</Link> : <Link href={`/claims/${c.id}/dispute?skill=${skill.id}`} className="link text-12 text-ink-2">Money</Link>}</td>
                  </tr>
                ))}
              </tbody>
            </Ledger>
          )}
        </div>
      </section>

      <section className="page rule-2 py-7">
        <h2 className="display text-20">Disputes <span className="mono text-13 text-ink-2">{disputes.length}</span></h2>
        <div>
          {firstLive ? <div className="flex justify-end pb-3"><Link href={`/claims/${firstLive.id}/dispute?skill=${skill.id}`} className="act">Dispute</Link></div> : null}
          {!disputes.length ? <p className="text-13 text-ink-2">None yet.</p> : (
            <Ledger>
              <thead><tr><th>claim</th><th>by</th><th className="num">counter-bond, USDC</th><th>bond on Arc</th><th>trace hash</th><th>evidence</th><th>status</th><th>age</th></tr></thead>
              <tbody>
                {disputes.map((d) => {
                  const ev = sourceLink(d.evidenceUri);
                  return (
                    <tr key={d.id}>
                      <td><Hash v={d.claimId} head={8} tail={6} /></td>
                      <td><Hash v={d.by} /></td>
                      <td className="num"><Money v={d.counterBond} tone={d.arcTxHash ? "seal" : "off"} unit={false} /></td>
                      <td>{d.arcTxHash ? <><Hash v={d.arcTxHash} head={8} tail={6} /><div><Ext href={arcTx(d.arcTxHash)}>Arcscan</Ext></div></> : <span className="text-12 text-ink-3">off-chain record</span>}</td>
                      <td><Hash v={d.traceHash} head={10} tail={6} /></td>
                      <td className="mono">{ev ? <Ext href={ev}>{d.evidenceUri}</Ext> : d.evidenceUri}</td>
                      <td><Stamp s={d.status} /></td>
                      <td className="mono whitespace-nowrap">{ageSince(d.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Ledger>
          )}
        </div>
      </section>

      <section className="page rule-2 py-7">
        <h2 className="display text-20">Resolutions <span className="mono text-13 text-ink-2">{resolutions.length}</span></h2>
        <div>
          {!resolutions.length ? <p className="text-13 text-ink-2">None yet.</p> : (
            <Ledger>
              <thead><tr><th>claim</th><th>outcome</th><th>winner</th><th>reason</th><th>settlement</th><th className="num">HCS seq</th></tr></thead>
              <tbody>
                {resolutions.map((r) => (
                  <tr key={r.claimId}>
                    <td><Hash v={r.claimId} head={8} tail={6} /></td>
                    <td><Stamp s={r.outcome} /></td>
                    <td><Hash v={r.winner} /></td>
                    <td className="mono">{r.reason}</td>
                    <td>{r.arcTxHash ? <><Hash v={r.arcTxHash} head={8} tail={6} /><div><Ext href={arcTx(r.arcTxHash)}>Arcscan</Ext></div></> : <span className="text-12 text-ink-3">off-chain record</span>}</td>
                    <td className="num">{r.hcsSequence || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </Ledger>
          )}
        </div>
      </section>
    </div>
  );
}
