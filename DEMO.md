# Demo script: three minutes, one take

Two minutes in the live app plus one terminal command, then one minute on the design and the three tracks.
Everything on screen is the hosted deployment (web https://dr7shuhqdeo3p.cloudfront.net, gateway
https://d32gga9078v6q0.cloudfront.net), testnet only. Read the **Say** column aloud at a normal pace; each step is
timed for that. The Hedera track requires the video to show a paid request executing, so step 5 is not optional.

Before recording:

- A browser window at 1440 px wide on the landing page. No wallet extension is needed: every step below is an
  off-chain record except the ones that only read Arc.
- A terminal in the repo with `.env` pointing `GATEWAY_URL` at the hosted gateway and the agent account holding at
  least 2 USDC and a few HBAR on Hedera testnet (`E2E_FRESH_PAYER=1` hands a throwaway payer 2 USDC from it). Run
  `E2E_FRESH_PAYER=1 pnpm buy cloud-helper` once before recording so you know Blocky402 is answering today; it is
  intermittently unreachable, and the fix is to wait a minute and retry.
- Check that `git-author` still shows `LIVE` in the registry. If someone broke it already, use `template-render`,
  `changelog-stamp`, `backup-notes` or `git-status` instead; each breaks exactly one rule the same way.

## Part 1: the app and one paid request (0:00 to 2:05)

| Time | Do | Say |
|---|---|---|
| 0:00 | Landing page `/`. Stay on the masthead. | Hi, I am Sumit and today I will be presenting Sigil, a trust layer for AI agent skills. An agent extends itself by installing skills, and one bad skill can leak a cloud key or drain a wallet. Today an agent has two signals about a skill, the author's description and a scanner's opinion, and neither one costs anything to be wrong. On Sigil, being trustworthy costs money. |
| 0:14 | Scroll to **Live from the gateway**. Point at the four numbers. | Someone stakes USDC behind one machine-testable claim about a skill: no env read, no network egress, no file access outside a list. Anyone who runs the skill and produces a trace that breaks the claim takes the stake. These numbers are live from the gateway: seventeen skills listed, USDC in escrow on Arc, claims broken, paid requests. |
| 0:26 | Click **Open the registry**. Hover the seal-red `10.000000` on `cloud-helper`, then the `0 / 1` on `json-pretty`. | Every skill, who published it, how much stands behind it, and a status. Red is real USDC in escrow on Arc; grey is an off-chain record. cloud-helper has ten dollars escrowed and is LIVE. json-pretty survived a dispute: the trace did not reproduce, so the staker kept the pot. Both outcomes exist. |
| 0:38 | Click **cloud-helper**. Point at `source hcs://1/…`, scroll to **Use this skill**, press **Request the source**. | The id is the sha256 of the source, and the source is pinned on Hedera as HCS-1; this pointer opens on HashScan. Access is metered per kilobyte. With no payment I get exactly what an agent gets: 402, two ways to pay, HBAR or USDC, settled by Blocky402 on Hedera. A browser cannot pay this. |
| 0:54 | Switch to the terminal. Run `E2E_FRESH_PAYER=1 pnpm buy cloud-helper`. Point at the `x402: paid` line and the HashScan link when they print. | An agent can. This pays the 402 once: it signs a partial Hedera transaction, Blocky402 submits it and pays the fee, the gateway serves the source and mints a licence NFT to the payer. No API key, no subscription, one settled transaction on Hedera. |
| 1:12 | Back in the browser, scroll to **Payments** on the same page (it refreshes on its own). Point at the new row: payer, amount, HashScan link, licence serial. | And there it is on the ledger: the payer, one thousand base units of USDC, the settlement on HashScan, licence serial. Every buyer so far is in this list. |
| 1:22 | Click **Registry**, click **git-author**, then **Dispute** on its claim row. | Now let's break one. git-author prints your git user from `~/.gitconfig`. Its author staked forty-five dollars that it reads no file outside its own folder. |
| 1:30 | Press **Run it in the sandbox**. Wait for the bundle to fill; point at the red `violations 1` line. | The gateway runs it in a sealed sandbox, records every env, file, network, subprocess and dynamic-code event, and hashes the trace. One violation: a read of `.gitconfig` in the home folder, with the line that did it. That trace is the evidence. No model adjudicated anything. |
| 1:43 | Type any `0x…` address as the disputer, press **Mock Selfie Check**, then **Record dispute**. Wait for the three ledger lines. | To dispute I post a counter-bond, a quarter of the stake, my trace hash, and a World Selfie Check proof, so one person cannot sit on both sides of a stake. Selfie Check is a labelled mock today; the rule it feeds is enforced. The bundle lands on Hedera as HCS-1, right there. |
| 1:55 | In **Money** press **Run resolver**, wait for `reproduced true`, then **Settle**. | The verifier re-runs my bundle from the pinned source. Same hash, reproduced. Settle, and the pot, stake plus bond, moves under the disputer. On the escrowed claims this is `resolve()` on SigilStake on Arc and the USDC moves for real; here it is an off-chain record, and the page says so. |

Optional if you are under time: **Register a skill** in the top bar, pick `word-count`, press **Register**: "Listing
is free. The gateway hashes it, pins it on Hedera and announces it; money enters only when someone opens a claim."

If a step stalls (Blocky402 or a mirror node hiccup), keep talking and retry once; the page never fakes a number.

## Part 2: design and the tracks (2:05 to 3:05)

Screen: the architecture figure (`docs/img/diagram-architecture.png`), then the README's Tracks section.

| Time | Say |
|---|---|
| 2:05 | Three chains, each for the one thing it is best at. Every claim, payment, dispute and verdict is an immutable Hedera message, because at sub-cent fees and three-second finality per-event records cost less than the stake they describe. Stakes are real dollars, so custody and settlement live on Arc, the USDC-native chain. Personhood comes from World, because without it one operator could manufacture a "survived a challenge" history with two wallets. |
| 2:25 | The rule underneath: no one is asked to trust a language model's verdict. The sandbox is deterministic across machines, the trace is canonical and hashed, the verifier re-runs the evidence, and the contract pays whichever side the evidence supports. The agent's policy follows: install only skills with capital at risk, dispute only on a reproduced violation. |
| 2:38 | **Hedera, AI and Agentic Payments.** A live x402-gated service on Hedera testnet settled through Blocky402, metered per kilobyte, an HTS licence NFT per buyer, an HCS-14 identity for the agent, and a full claim trail on one HCS topic. Every settlement is on HashScan; you just watched one. |
| 2:48 | **Arc, Best Agentic Economy with Circle Agent Stack.** SigilStake and DisputeResolver on Arc testnet; the agent holds its own Circle Agent Stack wallet and signs every approve, dispute and resolve as an ERC-4337 user operation. The full cycle, stake, bond, payout, has run five times on Arc. |
| 2:57 | **World, Selfie Check.** The nullifier is stored on every claim and dispute, and a dispute that reuses the claim's nullifier is refused, at the gateway and in the contract. Live Selfie Check is a labelled mock until sandbox access lands; the rule it feeds is enforced today. Thank you. |

## Reset between takes

url-title, json-pretty and whichever skill you broke stay broken in the index; that is fine for a second take, pick
another breakable example. The `pnpm buy` step needs `E2E_FRESH_PAYER=1` every time (a licence holder reads the
source free, so a repeat payer would show no payment). To start from a clean index, follow "Reset for another take,
on the box" in RUN.md section 6, then re-register the examples with `pnpm register examples/<name>`.

## Prompt for an architecture diagram

Paste this into ChatGPT (or any image model) to get a detailed architecture figure:

> Draw a detailed, clean system architecture diagram for "Sigil", a trust layer for AI agent skills, in a flat
> technical-documentation style (white background, thin dark lines, one red accent, monospace labels, no 3D, no
> gradients). Lay it out in three horizontal bands.
>
> Top band, "Participants": four actors left to right: Skill author, Staker, Disputer, AI agent (the buyer). Each is
> a small rounded box with an icon.
>
> Middle band, "Off-chain services" (grey background): (1) "Gateway" (Node/Express) with sub-boxes "Registry index
> (skills, claims, disputes, resolutions, payments)", "x402 paywall, per-KB pricing", "Verifier: re-runs the trace
> bundle", "POST /claims/:id/probe". (2) "Deterministic sandbox" with sub-boxes "scrubbed child process",
> "interposition shim: env / fs read / fs write / net / child_process / eval", "canonical trace → sha256". (3) "Web
> app" (Next.js) with screens "Registry", "Skill page (402 paywall, licences, payments)", "Register a skill", "Open a
> claim", "Dispute (Run it in the sandbox, counter-bond, Selfie Check), Money panel". (4) "Agent" with "install
> policy: capital at risk only", "pays x402", "probes in sandbox", "disputes on a reproduced violation", "Circle
> Agent Stack wallet (ERC-4337)".
>
> Bottom band, "Chains", three columns: "Hedera testnet": HCS registry topic (SKILL_REGISTERED, CLAIM_OPENED,
> DISPUTE_OPENED, RESOLVED), one HCS topic per claim, HCS-1 file pins for skill sources and trace bundles, HTS
> licence NFT, HCS-14 agent identity, and "Blocky402 facilitator (x402 settlement in HBAR or HTS USDC)". "Arc
> testnet": "SigilStake (openClaim, dispute, resolve; holds USDC)", "DisputeResolver (records the verdict)", "USDC".
> "World": "Selfie Check (personhood nullifier, one proof cannot hold both sides of a claim)".
>
> Draw numbered arrows for the lifecycle: 1 author registers a skill → gateway hashes source, pins HCS-1, announces on
> HCS; 2 staker opens a claim → USDC into SigilStake on Arc, CLAIM_OPENED on HCS, Selfie Check nullifier stored; 3
> agent pays x402 → Blocky402 settles on Hedera, licence NFT minted, source served; 4 agent or disputer runs the skill
> in the sandbox → trace bundle with violations; 5 dispute → counter-bond and trace hash on Arc, bundle pinned as
> HCS-1, DISPUTE_OPENED on HCS; 6 verifier re-runs the bundle → reproduced or not; 7 resolve() on Arc pays the pot to
> the winner, RESOLVED on HCS. Use solid arrows for money, dashed arrows for data, dotted for proofs. Add a small
> legend and a one-line caption: "No model adjudicates: capital at risk, deterministic evidence, anyone can re-run
> it."
