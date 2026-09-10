"use client";
import { useState, type ReactNode } from "react";
import { short } from "@/lib/format";

/** A ledger table; on narrow screens it scrolls inside its own container, never the page. */
export function Ledger({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="ledger">{children}</table>
    </div>
  );
}

/** Truncated id/hash/address in mono; click copies the full value. */
export function Hash({ v, head = 6, tail = 4, className = "" }: { v: string; head?: number; tail?: number; className?: string }) {
  const [copied, setCopied] = useState(false);
  if (!v) return <span className="text-ink-3">—</span>;
  return (
    <button
      type="button"
      title={v}
      aria-label={`Copy ${v}`}
      onClick={() => { navigator.clipboard?.writeText(v).then(() => { setCopied(true); setTimeout(() => setCopied(false), 900); }); }}
      className={`hash ${className}`}
    >
      {copied ? "copied" : short(v, head, tail)}
    </button>
  );
}

export function Ext({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" className="link">{children}</a>;
}

/** One line of a step-by-step flow: pending / running / ok / failed. Rendered as a numbered ledger that fills in as steps complete. */
export type Step = { label: string; state: "idle" | "run" | "ok" | "err"; note?: ReactNode };
const STATE: Record<Step["state"], [string, string]> = { idle: ["—", "text-ink-3"], run: ["running…", "text-ink-2"], ok: ["done", "text-ink"], err: ["failed", "text-seal"] };

export function Steps({ steps }: { steps: Step[] }) {
  if (!steps.length) return null;
  return (
    <div aria-live="polite">
      <Ledger>
        <thead><tr><th className="num">#</th><th>step</th><th>state</th><th>note</th></tr></thead>
        <tbody>
          {steps.map((s, i) => (
            <tr key={i} className={s.state === "idle" ? "text-ink-3" : ""}>
              <td className="num">{String(i + 1).padStart(2, "0")}</td>
              <td className="mono">{s.label}</td>
              <td className={`mono whitespace-nowrap ${STATE[s.state][1]}`}>{STATE[s.state][0]}</td>
              <td className="mono text-ink-2">{s.note}</td>
            </tr>
          ))}
        </tbody>
      </Ledger>
    </div>
  );
}
