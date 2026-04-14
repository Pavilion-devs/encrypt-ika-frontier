# Build Context

## Project

- Name: `liquidation_coordinator`
- Goal: Bridgeless sealed-bid liquidation primitive using Encrypt + Ika on Solana devnet.
- Current focus: drive the full resolve → request-decryption → finalize → Ika sign → Bitcoin broadcast flow from local TypeScript scripts while deferring the upstream Anchor-version jump.

## Official Sources

- Ika docs: `https://solana-pre-alpha.ika.xyz/`
- Ika repo: `https://github.com/dwallet-labs/ika-pre-alpha`
- Ika Solana pre-alpha program id: `87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY`
- Ika gRPC: `https://pre-alpha-dev-1.ika.ika-network.net:443`
- Encrypt docs: `https://docs.encrypt.xyz/`
- Encrypt repo: `https://github.com/dwallet-labs/encrypt-pre-alpha`
- Encrypt Solana pre-alpha program id: `4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8`
- Encrypt gRPC: `https://pre-alpha-dev-1.encrypt.ika-network.net:443`
- Additional non-normative reference: `https://github.com/kitty4D/encrypt-solana-prealpha-skill`

## Integration Risk

- Ika official docs/examples target `ika-dwallet-anchor` with `anchor-lang = "1"` and call out Anchor CLI `1.x`.
- Encrypt repo workspace also resolves `anchor-lang = "1"`, while its installation page still mentions `anchor-lang = "0.32"`.
- The local scaffold started on Anchor `0.31.0`; version alignment must be resolved before adding sponsor crates directly.
- Local strategy for now: vendor the thin CPI adapters from the official repos into this program and keep upstream crate adoption for a later milestone.
- Encrypt has a docs-vs-code mismatch for `execute_graph`: the prose says `num_inputs` is `u16`, but the repo macro/dev builder currently serializes it as `u8`. Follow repo code until upstream clarifies.
- The repo now includes `tools/liquidation_graph`, which emits the canonical `resolve_auction` graph bytes and the wrapped `execute_graph` instruction payload. The on-chain `resolve_auction` handler rejects non-canonical graph bytes and can default to the built-in graph when passed an empty vector.
- The canonical graph now produces two outputs: winner index and winning bid amount. The program stores the ordered bid set used at resolve time, requests decryption for both outputs, and finalizes using decrypted Encrypt state instead of trusting a caller-picked winning bid.
- Bitcoin/Ika has a deliberate hash split that the off-chain code must respect:
  - `finalize` / `MessageApproval` PDA seed uses `keccak256(bitcoin_preimage)`
  - Ika gRPC `Sign` for Bitcoin uses `hash_scheme = DoubleSHA256`, so the network signs `sha256d(bitcoin_preimage)`
  - The field name `btc_tx_hash` in the current on-chain code is therefore a misnomer; operationally it is the Ika approval lookup hash.
- The Ika gRPC side also needs the 32-byte dWallet DKG/session identifier for `session_identifier_preimage` / `dwallet_id`. In the local scripts this is threaded through `--approval-user-pubkey`; it should not be treated as a normal Solana pubkey.

## Milestones

- [x] Scaffold repo root with an Anchor workspace
- [x] Pull the official sponsor docs/repos locally for source-backed planning
- [x] Replace the template program with liquidation state/accounts/instructions
- [x] Choose a local CPI-adapter strategy based on the official sponsor repos
- [x] Add a deterministic local generator for `resolve_auction` graph bytes
- [x] Add local TypeScript bid + resolve scripts with a vendored Encrypt gRPC proto
- [x] Add local TypeScript scripts for resolution decryption + finalize
- [x] Add local TypeScript watcher + broadcaster scripts for Ika signing and Bitcoin P2WPKH assembly
- [ ] Resolve the Anchor version line and add official sponsor dependencies
- [ ] Run the full devnet / testnet integration end to end

## Build Status

- `mvp_complete`: `false`
- `tests_passing`: `false`
- `devnet_deployed`: `false`
- `program_id`: `9tzQ4FnSYVuqFA3EeYzKVPAZBtGq266TvuFR6H22rm59`
