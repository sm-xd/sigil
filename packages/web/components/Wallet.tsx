"use client";
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { arcTestnet } from "@/lib/chain";
import { short } from "@/lib/format";

/** Connect / disconnect + network note. Prompts a chain switch when the wallet is not on Arc testnet. */
export function Wallet() {
  const { address, isConnected, chainId: acctChain } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const onArc = isConnected && (acctChain ?? chainId) === arcTestnet.id;

  return (
    <div className="flex items-center gap-3">
      {isConnected ? (
        onArc ? (
          <span title="Arc testnet (5042002)">Arc testnet</span>
        ) : (
          <button type="button" onClick={() => switchChain({ chainId: arcTestnet.id })} className="act text-12" title="wrong network — click to switch to Arc testnet">
            {switching ? "switching…" : `wrong chain ${acctChain ?? chainId} → switch to Arc`}
          </button>
        )
      ) : null}
      {isConnected && address ? (
        <button type="button" onClick={() => disconnect()} className="btn mono" title={`${address} — click to disconnect`}>
          {short(address)}
        </button>
      ) : (
        <button type="button" onClick={() => connect({ connector: connectors[0], chainId: arcTestnet.id })} disabled={isPending || !connectors.length} aria-busy={isPending} className="btn mono" title={error?.message}>
          {isPending ? "connecting…" : connectors.length ? "Connect wallet" : "No injected wallet"}
        </button>
      )}
    </div>
  );
}

export function useArcWallet() {
  const { address, isConnected, chainId } = useAccount();
  return { address, isConnected, onArc: isConnected && chainId === arcTestnet.id };
}
