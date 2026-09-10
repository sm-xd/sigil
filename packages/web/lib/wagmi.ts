import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { arcTestnet } from "./chain";

// Injected connector only (MetaMask/Rabby/etc). ssr:true defers wallet state to the client so hydration matches.
export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  connectors: [injected()],
  transports: { [arcTestnet.id]: http() },
  ssr: true,
});

declare module "wagmi" {
  interface Register { config: typeof wagmiConfig }
}
