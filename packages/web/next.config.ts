import type { NextConfig } from "next";

// The repo-root .env is the single source of env for every package; Next only reads packages/web/.env*.
// Shell env wins (loadEnvFile never overrides), so `NEXT_PUBLIC_GATEWAY_URL=… next dev` still works.
try { process.loadEnvFile(new URL("../../.env", import.meta.url).pathname); } catch { /* no root .env */ }

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL ?? process.env.GATEWAY_URL ?? "http://localhost:4021";

const nextConfig: NextConfig = {
  transpilePackages: ["@sigil/shared"],
  agentRules: false,
  env: {
    NEXT_PUBLIC_GATEWAY_URL: GATEWAY,
    NEXT_PUBLIC_SIGIL_STAKE_ADDRESS: process.env.NEXT_PUBLIC_SIGIL_STAKE_ADDRESS ?? process.env.SIGIL_STAKE_ADDRESS ?? "",
  },
  // The gateway sends CORS headers (Access-Control-Allow-Origin: *, x402 headers exposed); the same-origin /gw/* rewrite is kept as a convenience.
  rewrites: async () => [{ source: "/gw/:path*", destination: `${GATEWAY}/:path*` }],
};

export default nextConfig;
