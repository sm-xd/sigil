// `pnpm seed` — thin entry so dependencies resolve from the gateway package (root has no viem/@x402).
// Thin entry: the seed lives in packages/gateway/src/seed.ts (imported dynamically so its env is loaded first).
import("../packages/gateway/src/seed.ts").then((m) => m.seed()).catch((e) => { console.error(e); process.exit(1); });
