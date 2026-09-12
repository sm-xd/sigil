# Sigil

**A trust layer for AI agent skills. Stake USDC on what a skill does. Break the claim with proof, and the money is yours.**

Nothing in Sigil asks anyone to trust a language model's opinion. The only thing standing behind a claim is capital at risk.

| | |
|---|---|
| 🌐 **Live web app** | https://dr7shuhqdeo3p.cloudfront.net |
| ⚙️ **Live gateway API** | https://d32gga9078v6q0.cloudfront.net/health |
| 📚 **Documentation** | [`/docs`](docs) &nbsp;·&nbsp; deep refs: [ARCHITECTURE](ARCHITECTURE.md) · [RUN](RUN.md) · [DEMO](DEMO.md) |
| 💻 **Repo** | https://github.com/sm-xd/sigil |

![The Sigil registry: six skills, the USDC staked on each, and the status of every claim](docs/img/registry.png)

---

## What is Sigil?

An AI agent extends itself by installing **skills** — small tools, MCP servers, snippets of code. One bad skill can leak a cloud key or drain a wallet. Today an agent has only two signals about a skill: the author's description, and a scanner's opinion. **Neither costs anything to be wrong.**

Sigil makes being trustworthy cost money. Someone stakes USDC behind a **specific, machine-testable claim** — for example, *"this skill reads no environment variable except `LOG_LEVEL`."* Anyone who can produce a deterministic trace that **breaks** that claim takes the stake. No human votes. No LLM verdict. Just reproducible evidence and money.

---

## How it works, in five steps

1. **Claim** — A person picks a skill and one of three testable rules (reads no secret env, opens no outside network, reads no outside file), proves they are a real distinct human with **World Selfie Check**, and locks USDC in the `SigilStake` contract on **Arc**. The claim is recorded on **Hedera**.
2. **Consume** — An agent finds the skill, pays a tiny per-kilobyte fee over **x402** (settled on Hedera by **Blocky402**), and gets the source plus a **licence NFT**. A person can do the same with `pnpm buy <skill>`.
3. **Probe** — The agent runs the skill in a **sealed, deterministic sandbox** with a normal and a malformed input. The sandbox denies everything by default and hashes the whole run into a trace.
4. **Dispute** — If the skill broke the rule, the agent posts a counter-bond and the trace to `SigilStake.dispute()` **from its own Circle Agent Stack wallet**, and uploads the evidence to Hedera.
5. **Settle** — An independent verifier **re-runs the exact evidence**. `reproduced = (hashes match) AND (violations > 0)`. `SigilStake.resolve()` pays the pot to the winner on Arc, and the outcome is written to Hedera.

Anyone can download the evidence from Hedera and re-run it. The truth is reproducible, not asserted.

---

## Why three chains

Each chain does the one job it is best at.

| Job | Chain | Why it must be there |
|---|---|---|
| Record every claim, challenge, and outcome | **Hedera (HCS)** | Sub-cent fees, 3s finality — writing every event is affordable |
| Mint the licence NFT | **Hedera (HTS)** | Native tokens, no contract to deploy |
| Sell paid access to a skill | **Hedera x402 (Blocky402)** | The paid-request rail, metered per call |
| Hold the staked USDC, pay the winner | **Arc** | Stakes are real money; Arc is USDC-native |
| Prove each participant is a distinct human | **World (Selfie Check)** | Stops one person funding both sides of a claim |

---

## What we're targeting

Sigil is built for three hackathon tracks at once. Full breakdown with every evidence link: [`docs/tracks.mdx`](docs/tracks.mdx).

### 🟣 Hedera — AI & Agentic Payments ($6,000)
| Requirement | Status |
|---|---|
| Live x402 service on Hedera testnet, settled by Blocky402 | ✅ Met |
| Agent consuming it with ≥ 1 real paid request | ✅ Met — **12 settled requests** |
| Public repo + README | ✅ Met |
| Demo video ≤ 5 min | ⏳ Pending |
| Extras: metering, HCS-14 identity, discovery, HTS, HCS audit trail | ✅ All met |

### 🔵 Arc — Best Agentic Economy with Circle Agent Stack ($3,500)
| Requirement | Status |
|---|---|
| Working frontend **and** backend | ✅ Met |
| Architecture diagram in repo | ✅ Met |
| Agent Stack wallet settles the agent's on-chain actions | ✅ Met — **5 full cycles** |
| Decision logic on real signals | ✅ Met |
| Testnet now, mainnet by Sept 30 | ✅ Testnet met · ⏳ mainnet pending |
| Video + presentation | ⏳ Pending |

### 🟢 World — Selfie Check ($3,500)
| Requirement | Status |
|---|---|
| Selfie Check as an abuse-prevention signal | ✅ Met (enforced + tested; live call mocked pending Sandbox access) |
| Working app | ✅ Met |
| Written feedback document | ✅ Met — [FEEDBACK-WORLD.md](FEEDBACK-WORLD.md) |

---

## Verified on testnet — open the proof

| What | Link |
|---|---|
| A real USDC payment settling over x402 | [HashScan](https://hashscan.io/testnet/transaction/0.0.7162784@1789216091.354310097) |
| A full dispute cycle paying out on Arc | [Arcscan](https://testnet.arcscan.app/tx/0xf9d4506fb3ac405769860e3ab4c34321e72a1f54a4cd7e2f3eeca04cdad5c1f1) |
| The Hedera registry of every claim & identity | [Topic 0.0.10483153](https://hashscan.io/testnet/topic/0.0.10483153) |
| The SigilStake escrow contract on Arc | [0x66fc6324…1566fe](https://testnet.arcscan.app/address/0x66fc6324ea9afd68a15f2f68ee5b3083391566fe) |

**Every transaction, with token transfers and fees:** [EVIDENCE.md](EVIDENCE.md).

**What's real vs mock:** almost everything runs live on testnet. The one exception is **World Selfie Check**, which runs as a clearly-labelled mock until Sandbox tester access lands — the abuse-prevention rule it feeds is fully built and tested. Details: [`docs/whats-real.mdx`](docs/whats-real.mdx).

---

## Run it

**Fastest — just open it:** https://dr7shuhqdeo3p.cloudfront.net

**Buy a real skill (one command):**
```bash
git clone https://github.com/sm-xd/sigil && cd sigil && pnpm install
# fill .env from .env.example (a Hedera testnet operator account)
E2E_FRESH_PAYER=1 pnpm buy slugify
```

**The whole loop locally:** see [RUN.md](RUN.md) — seed a staked claim, then run the agent end to end (`pnpm e2e`).

---

## Key addresses

| Item | ID / address |
|---|---|
| Hedera registry topic | `0.0.10483153` |
| Licence NFT (HTS) | `0.0.10483154` |
| Hedera USDC token | `0.0.429274` |
| Blocky402 facilitator | `https://api.testnet.blocky402.com` (feePayer `0.0.7162784`) |
| Arc chain | `5042002` (RPC `https://rpc.testnet.arc.network`) |
| SigilStake (Arc) | `0x66fc6324ea9afd68a15f2f68ee5b3083391566fe` |
| DisputeResolver (Arc) | `0xb741a78b1de72c81546f3d4d988bd4820d56e1a8` |
| Circle Agent Stack wallet | `0xf6ede0518f7543715322cf7bd420aa6a7732b2e0` |

---

## Documentation

- **[Docs site](docs)** — the friendly guide (Introduction, How it works, Architecture, x402, Tracks, Run it). Published with Mintlify.
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — package contracts, ABIs, HCS messages, the x402 sequence, determinism.
- **[RUN.md](RUN.md)** — every command, env var, expected log line, and the hosted-on-AWS setup.
- **[DEMO.md](DEMO.md)** — the five-minute demo shot list.
- **[EVIDENCE.md](EVIDENCE.md)** — every verified transaction, in full.
- **[FEEDBACK-WORLD.md](FEEDBACK-WORLD.md)** — first-hand Selfie Check integration feedback.

---

*Built for ETHGlobal. Personhood is load-bearing, not decoration: without it, one operator funds both sides of a stake and manufactures a track record for free. Sigil stops that with a per-person nullifier on every claim and dispute.*
