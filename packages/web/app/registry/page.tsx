"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getSkills } from "@/lib/api";
import { age, usdc } from "@/lib/format";
import { Hash, Ledger } from "@/components/Ledger";
import { Money } from "@/components/Money";
import { Stamp } from "@/components/Stamp";

export default function Registry() {
  const q = useQuery({ queryKey: ["skills"], queryFn: getSkills, refetchInterval: 5_000 });
  const skills = q.data ?? [];
  const escrowed = skills.reduce((a, s) => a + BigInt(s.totalEscrowed), 0n);
  const recorded = skills.reduce((a, s) => a + BigInt(s.totalStaked), 0n) - escrowed; // claims with no openClaim tx: recorded, not at risk

  return (
    <div className="page py-7">
      <h1 className="display text-20">Registry</h1>
      <div>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 pb-4">
          <p className="mono text-13">
            <Money v={escrowed} tone={escrowed > 0n ? "seal" : "off"} /> <span className="text-ink-2">escrowed on Arc across {skills.length} skills</span>
            {recorded > 0n ? <span className="text-ink-3"> · +{usdc(recorded)} recorded off-chain</span> : null}
          </p>
          <span className="mono ml-auto text-12 text-ink-3">{q.isFetching ? "polling…" : "polls every 5 s"}</span>
        </div>
        {q.isError ? <p className="mono text-13 text-seal">Gateway unreachable: {(q.error as Error).message}</p> : null}
        {q.isLoading ? <p className="mono text-13 text-ink-3">Loading the registry…</p> : null}
        {!q.isLoading && !q.isError && !skills.length ? <p className="text-14 text-ink-2">Nothing staked yet. Run <code>pnpm seed</code>.</p> : null}
        {skills.length ? (
          <Ledger>
            <thead>
              <tr><th>skill</th><th>author</th><th className="num">escrowed on Arc, USDC</th><th className="num">off-chain record, USDC</th><th className="num">live claims</th><th className="num">paid</th><th className="num">disputes sustained&nbsp;/ total</th><th className="num">oldest claim</th><th>status</th></tr>
            </thead>
            <tbody>
              {skills.map((s) => {
                const unstaked = s.totalStaked === "0";
                const offChain = BigInt(s.totalStaked) - BigInt(s.totalEscrowed);
                const status = s.sustainedDisputes ? "BROKEN" : s.totalEscrowed !== "0" ? "LIVE" : "RECORDED";
                return (
                  <tr key={s.id} className={unstaked ? "text-ink-3" : ""}>
                    <td><Link href={`/skills/${s.id}`} className="link whitespace-nowrap font-medium">{s.name}</Link><div className="mono text-12 text-ink-2"><Hash v={s.id} /></div></td>
                    <td><Hash v={s.author} /></td>
                    <td className="num">{s.totalEscrowed === "0" ? <span className="text-ink-3">—</span> : <Money v={s.totalEscrowed} tone="seal" unit={false} />}</td>
                    <td className="num">{offChain > 0n ? <Money v={offChain} tone="off" unit={false} /> : <span className="text-ink-3">—</span>}</td>
                    <td className="num">{s.liveClaims}</td>
                    <td className="num">{s.paidRequests}</td>
                    <td className="num"><span className={s.sustainedDisputes ? "text-seal" : ""}>{s.sustainedDisputes}</span> / {s.disputes}</td>
                    <td className="num">{age(s.oldestClaimAgeSec)}</td>
                    <td>{unstaked ? <span className="text-12 text-ink-3">no capital at risk</span> : <Stamp s={status} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </Ledger>
        ) : null}
      </div>
    </div>
  );
}
