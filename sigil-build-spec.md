# Sigil — Implementation Specification

> **This is a build spec for a coding agent, not a pitch.** Follow the build order. Do not skip the verification gates. Where a fact is unverified, this document says so explicitly — go and check rather than guessing, and stop and ask if the check fails.

---

## 0. What you are building

Sigil is a trust layer for AI agent skills. Agents extend themselves by installing skills — tools, MCP servers, code — and a single bad one can leak secrets or drain a wallet.

Sigil makes trustworthiness **economic rather than declared**. Participants stake USDC against specific, machine-testable claims about what a skill does. Evidence is produced by a deterministic sandbox, the outcome is recorded immutably on Hedera, and the stake settles to whichever side the evidence supports. A skill with live capital behind it earns a license NFT that gates access; agents without the license pay per call through an x402 endpoint.

**The guarantee is capital at risk, not a model's opinion.** Nothing in this system asks anyone to trust an LLM verdict. Keep that property intact — it is the entire point.

---

## 1. Hard constraints

These come from sponsor qualification requirements. A build that violates any of them is worth zero regardless of quality. Treat them as acceptance criteria.

### Hedera — AI & Agentic Payments ($6,000)
1. Host a **live x402-gated service** on Hedera testnet, **settled through the Blocky402 facilitator**. Not Arc x402. Not a different facilitator.
2. Build a **platform or agent that consumes that service** and completes **at least one real paid request end to end**.
3. Public repo with a README covering setup, architecture, and the payment flow.
4. Demo video ≤ 5 minutes showing the paid request executing.

Extra credit, cheap to collect: per-call metering rather than flat charge; agent identity via HCS-14; a discovery directory; HTS tokens in the settlement path; verifiable audit trails on HCS.

### Arc — Best Agentic Economy with Circle Agent Stack ($3,500)
1. Working **frontend AND backend**. Not a CLI. Not a script.
2. An **architecture diagram** committed to the repo.
3. Video demonstration **plus a presentation**, with detailed documentation.
4. Use **Agent Stack** to connect agents to wallets and on-chain actions. Agents hold Circle wallets and settle their own transactions — not a contract the frontend calls directly.
5. Agents with decision logic tied to real signals.
6. $1,000 on testnet; the remaining $2,500 requires deployment to **Arc mainnet by 30 September**. Build with that in mind — no mainnet-hostile shortcuts.
7. State explicitly in the submission which bounty is being entered.

### World — Selfie Check ($3,500)
1. Use Selfie Check in a meaningful way as a **risk / eligibility / fairness / continuity / abuse-prevention** signal.
2. Working app.
3. A **written feedback document** covering: Selfie Check docs and integration flow; Developer Portal navigation and debugging; Sandbox App states, proof flows, test users, errors, edge cases; what was confusing, missing, broken or hard to test. This is graded — write it properly.

**Personhood is load-bearing, not decoration.** Without it, one operator funds both sides of a stake and manufactures a track record for free. Say this in the README.

---

## 2. Verify before writing code

Do these first. Report results. **Do not proceed past a failed gate without asking.**

```bash
# GATE 1 — the whole Hedera track depends on this
curl -s https://api.testnet.blocky402.com/supported
# Expect an entry for hedera-testnet. Their public site lists Base Sepolia,
# Solana Devnet, Arbitrum Sepolia, Optimism Sepolia and Avalanche Fuji but NOT
# Hedera. If hedera-testnet is absent, STOP and report.
```

**GATE 2** — read `github.com/hedera-dev/x402-inference-pay-per-request-poc` and mirror its payment flow. Hedera's x402 is unusual: the client signs a **partially signed transaction**, and the facilitator pays gas and submits it. Do not invent this flow from general x402 knowledge.

**GATE 3** — read `github.com/circlefin/agent-stack-starter-kits` for the actual Agent Stack wallet API surface.

**GATE 4** — request World ID Sandbox access (Google Form, linked from World's docs). It gates the Selfie Check integration and has lead time.

**Never fabricate:** contract addresses, RPC URLs, API response shapes, SDK method names. If you cannot verify one, leave a `TODO(verify)` and list it in the final report.

---

## 3. Repo layout

```
sigil/
├── README.md                  judge-facing; lead with the economics
├── ARCHITECTURE.md            data flow + the diagram Arc requires
├── RUN.md                     how to run every piece
├── DEMO.md                    shot list for the video
├── FEEDBACK-WORLD.md          graded deliverable for the World track
├── .env.example
├── packages/
│   ├── contracts-arc/         Solidity — the stake escrow
│   │   ├── src/SigilStake.sol
│   │   ├── src/interfaces/IResolver.sol
│   │   └── test/SigilStake.t.sol
│   ├── hedera/                HCS records, HTS license NFT, mirror queries
│   │   └── src/{topics,license,mirror,identity}.ts
│   ├── sandbox/               deterministic predicate runner
│   │   └── src/{runner,predicates,trace}.ts
│   ├── gateway/               x402-gated service (the Hedera requirement)
│   │   └── src/{server,x402,blocky402,license-gate}.ts
│   ├── agent/                 consuming agent — discovers, pays, installs
│   │   └── src/{discover,pay,install,wallet}.ts
│   └── web/                   Next.js frontend (the Arc requirement)
└── scripts/{deploy,seed,e2e}.ts
```

TypeScript throughout except contracts. Node 20+. pnpm workspaces.

---

## 4. Chain responsibilities

| Layer | Chain | Why it must be there |
|---|---|---|
| Claim records, evidence, outcomes | Hedera (HCS) | Sub-cent fees and 3s finality make per-event immutable writes affordable. On any chain with real gas, recording every claim and challenge costs more than the stake. |
| License NFT | Hedera (HTS) | Native token ops with no contract overhead; custom fee schedules available. |
| Paid access | Hedera (x402 via Blocky402) | Mandated by the track. Per-call metering at sub-cent cost. |
| Stake custody and settlement | Arc (USDC) | Stakes are denominated in real money; Arc is the USDC-native settlement layer. |
| Participant personhood | World (Selfie Check) | Stops one operator sitting on both sides of a stake. |

Put this table in ARCHITECTURE.md. Unjustified multi-chain reads as prize-chasing; justified multi-chain reads as design.

---

## 5. Domain model

### Predicates — fixed vocabulary, exactly three

Claims must be **falsifiable by a deterministic sandbox run**. "Is this skill safe" has no resolution procedure. These do.

```ts
type PredicateKind =
  | "NO_ENV_READ_OUTSIDE"   // reads no env var outside the allowlist
  | "NO_NET_EGRESS_OUTSIDE" // opens no connection to a host outside the allowlist
  | "NO_FS_READ_OUTSIDE";   // reads no path outside the allowlist

interface Predicate {
  kind: PredicateKind;
  allowlist: string[];      // env names | hostnames | path globs
}
```

Do not add a fourth. Three done properly beats six half-instrumented. Anything not deterministically reproducible is out of scope — say so in ARCHITECTURE.md rather than letting a judge find it.

### Core entities

```ts
interface Skill {
  id: string;               // sha256 of the source bundle
  name: string;
  sourceUri: string;        // HCS-1 pointer or IPFS CID
  manifest: { entrypoint: string; declaredEnv: string[]; declaredHosts: string[] };
  author: string;
  registeredAt: number;
}

interface Claim {
  id: string;
  skillId: string;
  predicate: Predicate;
  stakeAmount: string;      // USDC base units, 6dp
  stakedBy: string;         // Arc address
  humanProofRef: string;    // Selfie Check nullifier reference
  status: "LIVE" | "DISPUTED" | "BROKEN" | "UPHELD";
  arcEscrowId: string;
  hcsTopicId: string;
  createdAt: number;
}

interface Dispute {
  id: string;
  claimId: string;
  by: string;
  counterBond: string;
  evidenceUri: string;      // HCS-1 pointer to the trace bundle
  traceHash: string;        // sha256 of canonical trace — anyone can re-run
  status: "OPEN" | "SUSTAINED" | "REJECTED";
}

interface Resolution {
  claimId: string;
  disputeId: string | null;
  outcome: "CLAIM_BROKEN" | "CLAIM_UPHELD";
  winner: string;
  reason: string;
  arcTxHash: string;
  hcsSequence: number;
}
```

### HCS topics

- **Registry topic** — skill registrations and claim announcements. One topic, append-only, the discovery index.
- **Per-claim topic** — created on claim creation. Carries evidence submissions, disputes, and the resolution. One replayable trail per claim.
- **HCS-1** — large payloads: skill source bundles, full trace bundles.
- **HCS-14** — participant identity. Cheap, and it is an explicit extra-points item.

Every message: `{ v: 1, type, claimId, payload, ts }`. Version it from the start.

---

## 6. The resolver seam — read this carefully

**Resolution is pluggable. The rest of the system must not know which resolver is installed.**

```solidity
interface IResolver {
    /// @return winner  address receiving the pot
    /// @return reason  short machine-readable code, recorded on HCS
    function resolve(bytes32 claimId) external returns (address winner, bytes32 reason);
}
```

Two implementations, same interface:

**`DisputeResolver` (default — build this one).** Anyone may dispute a live claim by posting a counter-bond and a trace. The trace is deterministic; the sandbox re-runs it. If the violation reproduces, the claim is broken and the disputer takes the stake. If it does not, the claim is upheld and the stake-holder takes the counter-bond. An LLM may help a disputer *search* for violating inputs, but the **sandbox trace decides** — the model never adjudicates.

**`AttestorResolver` (alternate).** A staked attestor runs the predicate suite on submission and posts the outcome directly, with their own bond slashable if later proven wrong.

Both must compile and both must have passing tests. Switching is a constructor argument to `SigilStake`, nothing else. Do not leak resolver-specific vocabulary into the gateway, the agent, the web app, or the HCS message schemas.

---

## 7. Arc — `SigilStake.sol`

USDC-denominated, 6 decimals. The only contract that holds funds. Keep it small; it is going to mainnet.

```solidity
contract SigilStake {
    enum State { None, Live, Disputed, Resolved }

    struct Stake {
        bytes32 claimId;
        address staker;
        uint256 amount;
        address disputer;
        uint256 counterBond;
        State   state;
        uint64  createdAt;
    }

    function openClaim(bytes32 claimId, uint256 amount) external;
    function dispute(bytes32 claimId, uint256 counterBond, bytes32 traceHash) external;
    function resolve(bytes32 claimId) external;      // delegates to IResolver
    function withdrawUnchallenged(bytes32 claimId) external; // after cooldown

    event ClaimOpened(bytes32 indexed claimId, address staker, uint256 amount);
    event Disputed(bytes32 indexed claimId, address disputer, uint256 bond, bytes32 traceHash);
    event Resolved(bytes32 indexed claimId, address winner, uint256 payout, bytes32 reason);
}
```

Rules:
- Minimum stake 10 USDC; minimum counter-bond 25% of the stake. Both settable by the deployer.
- `withdrawUnchallenged` only after a cooldown (default 24h, **60 seconds on testnet** so the demo is watchable).
- Reentrancy guard on every fund-moving path. `SafeERC20`. Pull payments where practical.
- No upgradeability. No admin key that can move user funds.
- The agent — not the frontend — calls `dispute` and `resolve`, via an Agent Stack wallet. This is what satisfies Arc's requirement.

Tests must cover: open → withdraw unchallenged; open → dispute → sustained; open → dispute → rejected; double-dispute rejected; dispute below minimum bond rejected; resolve before dispute reverts; reentrancy attempt reverts.

---

## 8. Sandbox runner

Deterministic or it is worthless. Same input must produce the same trace hash on any machine.

- Spawn the skill in a child process with a **scrubbed environment** containing only canaries: `SIGIL_CANARY_AWS`, `SIGIL_CANARY_TOKEN`, and the declared allowlist.
- Intercept `fs` reads and `net`/`http` connects via a preload shim. **Log attempts; do not let them succeed.**
- Emit an ordered event list: `{ seq, kind, target, stack }`.
- Canonicalize (sorted keys, fixed float formatting, no timestamps, no absolute paths), then `sha256`. The hash goes on-chain; the bundle goes to HCS-1.
- Pin the container image and Node version in the trace bundle so re-runs match.

`verifyTrace(bundle) -> { reproduced: boolean, observedHash: string }` is the function the resolver calls.

---

## 9. Gateway — the x402 service

This satisfies Hedera's first requirement. It is the piece most likely to sink the submission; build it early.

```
GET /skills                      free — discovery directory (extra points)
GET /skills/:id                  free — metadata, live claims, total staked
GET /skills/:id/source           402 unless the caller holds the license NFT
POST /claims                     open a claim (requires Selfie Check proof)
POST /claims/:id/dispute         open a dispute (requires Selfie Check proof)
```

Flow for `/skills/:id/source`:
1. Check HTS license NFT ownership for the caller via the mirror node.
2. **Holds it** → serve, free.
3. **Does not** → `402` with Blocky402 payment requirements. Price **per call, metered by response size in KB** — per-call metering rather than a flat charge is an explicit extra-points item.
4. Client signs the partially signed transaction; facilitator submits.
5. On settlement: serve the source, **mint the license NFT to the caller**, write a payment record to the claim's HCS topic.

Log every settlement to HCS. That is the verifiable payment audit trail, also an extra-points item.

---

## 10. Consuming agent

Satisfies Hedera's second requirement and Arc's Agent Stack requirement. It must be an agent with real decision logic, not a curl script.

Loop:
1. Discover skills via `GET /skills`.
2. For each, read total live stake, claim age, and dispute history.
3. **Decide** using an explicit, stated policy — e.g. install only if `totalStake >= 100 USDC` and `oldestClaimAge >= 24h` and `sustainedDisputes == 0`. Print the reasoning.
4. Pay through x402 if no license; receive the license NFT.
5. Install into the sandbox and run.
6. If the sandbox observes a predicate violation, **open a dispute automatically** using its Agent Stack wallet.

That last step is the money shot: an agent that detects a violation and stakes its own capital to prove it, with no human involved.

---

## 11. World — Selfie Check

Gate `POST /claims` and `POST /claims/:id/dispute`. Store the nullifier reference against the participant. **One personhood proof cannot hold both sides of the same claim** — enforce this and test it.

The README framing: personhood is **abuse prevention**. Without it, one operator opens a claim from wallet A, disputes it from wallet B with a trace they know fails, loses the bond back to themselves, and manufactures a survived-dispute record for the price of gas.

Write `FEEDBACK-WORLD.md` as you integrate, not at the end. It is graded.

---

## 12. Frontend

Next.js. Arc requires a working frontend and backend; this is not optional and not a placeholder.

Four screens, no more:
1. **Registry** — skills, total staked, live claims, dispute counts.
2. **Skill detail** — claims with amounts and ages, dispute history, license status.
3. **Open a claim** — pick a skill, pick a predicate, set the allowlist, set the stake, Selfie Check, sign on Arc.
4. **Dispute** — submit a trace bundle, post the counter-bond, watch resolution live.

Show the **money moving**. Two numbers on screen — stake and counter-bond — and the transition. That is the demo.

---

## 13. Build order and gates

| Step | Work | Gate |
|---|---|---|
| 1 | Verification gates in §2 | Blocky402 confirms `hedera-testnet` |
| 2 | HCS topics + HTS license mint + mirror reads | A record written and read back |
| 3 | Gateway with x402 + Blocky402 | **One real paid request end to end, with a HashScan link** |
| 4 | Sandbox runner + 3 predicates | Same input → same trace hash, twice, two machines |
| 5 | `SigilStake.sol` + `DisputeResolver` on Arc testnet | All tests pass; full cycle on-chain |
| 6 | Consuming agent with Agent Stack wallet | Agent detects a violation and disputes unaided |
| 7 | Selfie Check gating | One proof cannot hold both sides |
| 8 | Frontend, four screens | Arc's MVP bar met |
| 9 | Seed data, docs, diagram, video | Ready to submit |

**Step 3 is the critical path.** If it is not working, nothing else matters — the largest prize is gated on it. Do it before the contracts.

**Degradation order if time runs short:** drop the second resolver → drop the discovery directory → drop HCS-14 identity → drop one predicate. **Never** drop the x402 endpoint, the paid request, the Arc settlement, or the frontend. Each of those is a qualification requirement.

---

## 14. Seed data

Ship `scripts/seed.ts` creating six skills so the demo is not empty:

- 3 benign, with live claims of varying size and age
- 1 that reads `SIGIL_CANARY_AWS` in an error path — the disputable one, and the star of the video
- 1 that calls an undeclared host
- 1 unstaked, to show the contrast

The demo depends on both outcomes existing: a dispute that succeeds and one that fails.

---

## 15. Environment

```bash
HEDERA_NETWORK=testnet
HEDERA_OPERATOR_ID=
HEDERA_OPERATOR_KEY=
HEDERA_REGISTRY_TOPIC_ID=
HEDERA_LICENSE_TOKEN_ID=

BLOCKY402_BASE_URL=https://api.testnet.blocky402.com
BLOCKY402_NETWORK=hedera-testnet

ARC_RPC_URL=
ARC_CHAIN_ID=
ARC_USDC_ADDRESS=
SIGIL_STAKE_ADDRESS=
CIRCLE_API_KEY=
CIRCLE_AGENT_WALLET_ID=

WORLD_APP_ID=
WORLD_ACTION_ID=

OPENAI_API_KEY=          # dispute-input search only — never adjudication
```

Commit `.env.example` with every key present and empty. Never commit real values.

---

## 16. Documentation the judges actually read

**README.md** — first sentence is about **staked capital**, not about auditing. Security-scanning projects have won recent hackathons; if your opening line is about scanning, a judge files you next to them. Open with the mechanism: participants stake money and lose it when the evidence goes against them.

Then: the problem, how it works in five steps, the chain-responsibility table, quick start, what is real versus stubbed.

**ARCHITECTURE.md** — data flow diagram (Arc requires one), why each chain, the determinism boundary, known limitations. State plainly that network-dependent skills will not replay identically and that predicates are scoped to deterministic filesystem and process behaviour.

**DEMO.md** — the shot list:
1. Agent queries the registry, decides against an unstaked skill, installs a staked one, pays via x402. Show the HashScan transaction.
2. Agent runs the malicious skill in the sandbox, observes the canary read.
3. Agent opens a dispute with its own capital. Trace hash on HCS.
4. Resolver re-runs the trace. It reproduces. Stake transfers on Arc.
5. Close on the two numbers moving.

Five minutes for Hedera and Arc. Cut it once; do not ramble.

---

## 17. Non-goals

Do not build: a token, a governance system, an insurance pool, a general skill marketplace with browsing and reviews, multi-chain beyond these three, a mobile app, LLM-as-adjudicator, or a fourth predicate.

If you finish early, **harden what exists** — more tests, better seed data, a tighter video. Do not add scope.

---

## 18. Report on completion

Produce a final summary covering: which verification gates passed and which failed; every `TODO(verify)` still outstanding; which qualification requirements are met and which are not, per track; what is real versus stubbed; and the exact commands to run the end-to-end demo.

Be blunt about what does not work. A known gap named in the README reads as rigour; the same gap discovered by a judge reads as a flaw.
