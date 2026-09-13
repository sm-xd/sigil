# Arc and Circle Agent Stack integration feedback

What Sigil used: Arc testnet for `SigilStake` and `DisputeResolver` (Foundry), USDC as the staked asset, the Circle
CLI (`circle wallet …`) as the agent's wallet backend, every `approve`, `dispute` and `resolve` sent as an ERC-4337
user operation from a smart account, and faucet.circle.com for both the deployer and the agent. Each item: the
sentence, what we expected, the fix we propose.

1. **Login cannot be scripted.** `circle login` needs terms acceptance and a one-time code, so the agent's wallet
   cannot be provisioned in CI or on a fresh box without a person. Expected: a service credential or API-key login
   for non-interactive use. Fix: an env-var credential path, with the interactive login kept for humans.
2. **The smart account deploys itself on the first `execute`.** The first user operation is slower and costs more
   than the rest, and nothing says why. Expected: a note, or an explicit `circle wallet deploy`. Fix: print
   "deploying the account with this operation" the first time.
3. **`--output json` has no stable field for the transaction hash.** We look for `txHash`, `transactionHash`, `hash`
   and `transaction.*` ([`wallet.ts`](packages/agent/src/wallet.ts)). Expected: one documented field. Fix: name it in
   the reference and keep it.
4. **Native transfers must omit `--token`.** Passing the USDC address for a native transfer on Arc errors in a way
   that does not say "omit the flag". Expected: the help text to say native means no token flag. Fix: one line in
   `circle wallet transfer --help`.
5. **Gas on Arc is USDC.** A first-hour question that the quick start could answer in a sentence. Fix: say it next to
   the faucet link.
6. **Faucet limits.** faucet.circle.com drips about 20 USDC with a two-hour cooldown per address, which is enough for
   one demo cycle at `minStake` 10 USDC but not for a seed of several claims. Expected: a way to request a larger
   testnet amount for a project. Fix: a per-project allowance, or a note on how to ask.

What worked well: `circle wallet fund` drips 20 USDC instantly, which made the first on-chain cycle possible in
minutes; `circle wallet execute … --contract --address --chain --rpc-url` covered every call we needed without an
SDK; Arc's RPC and Arcscan were fast enough that a full stake, dispute and resolve cycle reads back within seconds.
