"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { STAKE_ADDRESS, WORLD_MODE } from "@/lib/chain";
import { Wallet } from "./Wallet";

const LINKS = [["/registry", "Registry"], ["/claims/new", "Open a claim"]] as const;

/** One hairline-ruled row: the mark, two links, and on the right the wallet plus the stub notes that apply. */
export function Nav() {
  const path = usePathname();
  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex max-w-page flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3 md:px-8">
        <Link href="/" className="flex items-center gap-2 text-14 font-medium">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="10" cy="10" r="9" /><path d="M14.5 5.5 5.5 14.5" /></svg>
          Sigil
        </Link>
        <nav className="flex gap-5 text-13">
          {LINKS.map(([href, text]) => (
            <Link key={href} href={href} aria-current={path === href ? "page" : undefined} className="text-ink-2 hover:text-ink aria-[current=page]:text-ink motion-safe:transition-colors">{text}</Link>
          ))}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-11 text-ink-2">
          {WORLD_MODE === "mock" ? <span title="NEXT_PUBLIC_WORLD_MODE=mock — World Sandbox access pending">mock Selfie Check</span> : null}
          {!STAKE_ADDRESS ? <span title="SIGIL_STAKE_ADDRESS empty — claims are recorded off-chain">contract undeployed</span> : null}
          <Wallet />
        </div>
      </div>
    </header>
  );
}
