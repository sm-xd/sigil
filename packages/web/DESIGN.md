# Sigil web — design brief

The web app is a ledger, not a dashboard. Every screen shows money, who put it there, and what evidence moved it. The look must be
recognisably its own: a printed financial ledger with a seal on it, not a dark SaaS dashboard.

## Direction

- **Archetype:** editorial ledger. Warm paper background, ink text, hairline rules, one seal-red accent. Light theme only, on purpose.
- **Density:** comfortable on the landing page; compact, table-first inside the app.
- **Surface:** flat. Sections are separated by rules and whitespace, not by cards. No card-in-card, no shadows, no glass, no gradients.
- **Type mood:** serif display, tabular monospace figures, quiet sans body. Three weights maximum (400, 500, 600).
- **Motion:** almost none. 150 ms opacity/transform on state changes; the money panel's settlement move is the one deliberate animation (400 ms ease-out, entry longer than exit).

## Tokens (CSS variables in `app/globals.css`)

```
--paper:      #F4F1EA   page background (warm, never pure white)
--paper-2:    #FBFAF6   raised surfaces (inputs, the money panel)
--ink:        #16130F   text, rules at low alpha (never #000)
--ink-2:      #5F5A50   secondary text
--ink-3:      #9A9488   placeholders, disabled
--rule:       rgba(22,19,15,0.14)  hairlines
--rule-2:     rgba(22,19,15,0.32)  strong rules (table header, section starts)
--seal:       #B3261E   the single accent: capital at risk, BROKEN, primary action
--seal-ink:   #7A1912   hover/pressed seal
--upheld:     #3E6B3A   UPHELD only (semantic, sparse)
--radius-ctl: 2px       inputs and buttons
--radius-tag: 3px       status stamps
```
Tables have no radius. Nothing else is rounded.

## Type (next/font/google, self-hosted at build)

- Display and page titles: **Fraunces** (serif, optical size on, weight 500), tracking -0.02em, sizes 28/40/56.
- Money, ids, hashes, timestamps: **IBM Plex Mono**, `font-variant-numeric: tabular-nums`, sizes 12/13/14, big money at 32/44.
- Body and labels: **IBM Plex Sans**, sizes 13/14/16, labels uppercase 11px with 0.08em tracking in `--ink-2`.
- Scale: 11 / 12 / 13 / 14 / 16 / 20 / 28 / 40 / 56. Nothing else.

## Layout

- Max width 1120px, left-aligned, never centred blocks of copy. A 200px label column on the left of app pages ("Registry", "Claim", "Dispute") with content to the right on desktop; stacks on mobile.
- Ledger tables: full-width, header row in 11px uppercase with a strong rule under it, body rows separated by hairlines, amounts right-aligned and tabular, ids in mono truncated to 10 characters with copy on click, no zebra striping, no hover cards.
- Status is a **stamp**: uppercase 11px, 1.5px border in the status colour, 2px 8px padding, `--radius-tag`, slightly rotated (-2deg) for BROKEN and UPHELD only. LIVE and RECORDED are unrotated, ink-coloured. Never a filled pill.
- Amounts: `10.000000 USDC` with the unit in `--ink-2`; capital at risk in `--seal`; off-chain records in `--ink-3`.

## Pages

1. `/` **Landing** (new). Sections in order, each separated by a strong rule and a numbered margin label (01, 02, …):
   - Masthead: the word "Sigil" in Fraunces, then one specific sentence: "Every claim about an AI skill on Sigil has USDC behind it. Produce the trace that breaks the claim and the stake is yours." Then two links: "Open the registry" (primary, seal) and "Read the proof" (secondary, underline).
   - Live strip pulled from the gateway (`GET /skills`): skills listed, USDC escrowed, claims broken, paid requests, last settlement id with its Arcscan link. Real numbers, refreshed every 10 s; if the gateway is down, show "gateway offline" in `--ink-3`, never fake numbers.
   - "How a claim dies" as a five-row ledger: Claim (stake locked on Arc), Consume (x402 payment on Hedera settled by Blocky402), Probe (deterministic sandbox, trace hash), Dispute (counter-bond, trace on HCS-1), Settle (verifier re-runs, stake moves). Each row: number, verb, one sentence, the chain it happens on in mono.
   - "Why three chains" as the same table the README carries (Hedera HCS, Hedera HTS, Hedera x402, Arc, World) — one line each.
   - "What is real" with the three verified links (the Blocky402 settlement, the Arc resolve transaction, the HCS claim topic) and the one honest stub (Selfie Check runs as a labelled mock until sandbox access).
   - Footer: the exact command to run it, in mono.
   No hero image, no icon grid, no testimonials, no "backed by", no gradient text.
2. `/registry` (was `/`): the ledger table of skills. Columns: skill (name over mono id), author, escrowed on Arc, recorded off-chain, live claims, paid requests, disputes sustained/total, oldest claim, status stamp. Header shows total escrowed in `--seal` and the poll interval. Empty state: "Nothing staked yet. Run `pnpm seed`."
3. `/skills/[id]`: manifest as a definition list; "Use this skill" (label column "Access"): the price per KB and per request from `GET /skills/:id/access`, a "Request the source" button that fetches the paywall and renders the 402 legs inline, licence holders and payments as two ledgers, the agent command to copy; claims, disputes and resolutions as three ledgers; the "Open a claim" and "Dispute" actions as seal-red text buttons on the right of the section titles.
4. `/claims/new`: a single left-aligned form column (max 560px) with the label column explaining each field in `--ink-2`; steps shown as a numbered ledger that fills in as they complete (nonce, approve, openClaim, record).
5. `/claims/[id]/dispute`: two columns. Left: the stake you are attacking (big mono figure), trace bundle input, counter-bond, human check, action. Right: the money panel as a ledger entry with two columns "staker" and "disputer", amounts in mono, a rule between; on resolution the pot line moves under the winner with the one animation, then the outcome stamp appears.

## Copy rules

- Specific over aspirational. Never "build the future", "seamless", "cutting-edge", "next-gen".
- Name the number, the chain and the transaction. Prefer "10.000000 USDC escrowed on Arc" to "secured".
- Stubs are labelled on screen exactly as they are: "Mock Selfie Check (World Sandbox access pending)", "off-chain record".
- Buttons are verbs: "Open the registry", "Post 2.500000 USDC bond on Arc", "Record dispute".

## Do / Don't

Do: hairlines, left alignment, tabular figures, one accent, real data, a stamp for status, generous section spacing (72–96px on the landing page).
Don't: dark theme, gradients, glassmorphism, cards with shadows, icon grids, centred hero, rounded pills, multiple accents, `transition: all`, pure black, decorative animation, emoji.
