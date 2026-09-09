# World ID (Selfie Check) integration notes — gateway side

Raw notes from wiring `POST /claims` and `POST /claims/:id/dispute` behind a personhood proof. Feeds `FEEDBACK-WORLD.md`.

## What the gateway does

- `WORLD_MODE=sandbox`: the full IDKit v4 result is forwarded verbatim to `POST https://developer.world.org/api/v4/verify/{rp_id}`; a 2xx means verified. The nullifier is taken from `responses[0].nullifier` of the IDKit result.
- `WORLD_MODE=mock`: `{ mock: true, nullifier: "0x…" }` is accepted as-is and the boot log says so loudly. Mock proofs are rejected in sandbox mode.
- The nullifier is stored on the claim (`humanProofRef`) and on every dispute. A dispute whose nullifier equals the claim's is refused with 409 ("one personhood proof cannot hold both sides of a claim"). Tested in `src/index.test.ts`.
- `POST /world/rp-context { action }` returns `{ rp_id, nonce, created_at, expires_at, signature }` signed with `WORLD_RP_SIGNING_KEY` via `@worldcoin/idkit-core/signing`.

## Confusing / missing / broken

1. **The verify endpoint and the `rp_context` shape came from a reference project, not from the docs.** The only place I could confirm `POST /api/v4/verify/{rp_id}` (body = the raw IDKit result) and `rp_context = { rp_id, nonce, created_at, expires_at, signature }` was an existing integration. Both are marked `TODO(verify)` against the official docs.
2. **The v4 verify response body is opaque.** The reference integration ignores it and reads the nullifier from the IDKit result it just sent. Whether the API echoes the nullifier, the action, or anything usable for the both-sides check is unknown. A documented success body would remove a trust-on-client-payload step.
3. **Nullifier stability is load-bearing and undocumented (to me).** The both-sides rule assumes one human → one nullifier per `action`. If v4 rotates nullifiers per session or per proof, the rule silently degrades to per-proof. Need a clear statement per proof type (uniqueness vs session).
4. **`signRequest` returns camelCase (`createdAt`, `expiresAt`, `sig`) while `rp_context` wants snake_case (`created_at`, `expires_at`, `signature`).** Easy to get wrong; a helper that emits the `rp_context` object directly would save a round of debugging.
5. **`@worldcoin/idkit-core/signing` is a re-export of `@worldcoin/idkit-server`.** Fine at runtime, but it is not obvious which package owns `signRequest`, and whether `signingKeyHex` accepts a `0x` prefix is unstated (not tested here: no key was available).
6. **No sandbox credentials were available while building** (`NEXT_PUBLIC_WORLD_APP_ID`, `NEXT_PUBLIC_WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY` are empty pending Sandbox access), so the sandbox path is implemented but untested end to end. The `rp-context` route therefore returns an explicit 500 "not configured" today.
7. **Is there a separate sandbox verify URL?** `WORLD_ENVIRONMENT=sandbox` exists in the env, but whether the verify endpoint differs between sandbox and production (or whether `environment` is only an IDKit client flag) is unclear.
8. **Error body shape.** The reference reads `detail` from a non-2xx verify response. If that is not the documented error contract, our 400 messages will be generic.

## Open items to close once Sandbox access lands

- Run one real Selfie Check in sandbox mode and record: the exact IDKit result keys, the verify success/error bodies, and whether the nullifier is identical across two proofs for the same test user + action.
- Test whether a proof for action A can be replayed on action B (it must not; the gateway uses one action `sigil-participant` for both claims and disputes so the both-sides rule holds).
