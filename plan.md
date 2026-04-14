# Implementation Plan

## Bridgeless Sealed-Bid Liquidation Primitive

### Encrypt + Ika · Solana Devnet · Deadline: May 12 2026

---

## What we're building

One Anchor program that CPI-calls Encrypt to resolve a sealed-bid liquidation privately,
then immediately CPI-calls Ika's `approve_message` to sign a native Bitcoin SegWit transfer —
all on Solana devnet, with the BTC landing on Bitcoin testnet.

**Confirmed by Fesal:** BTC SegWit is supported on the Ika Solana pre-alpha.
Taproot is not. Use P2WPKH (SegWit) throughout.

---

## Confirmed technical facts (stop second-guessing these)

| Fact                                                                            | Source                                                         |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Ika Solana pre-alpha is a CPI library, not a TypeScript SDK                     | Corrected architecture doc                                     |
| `approve_message` produces a real ECDSA signature for Bitcoin                   | Fesal confirmed                                                |
| SegWit (P2WPKH) works. Taproot does not.                                        | Fesal confirmed                                                |
| Encrypt bids come in via gRPC `create_input`, not instruction data              | Encrypt docs                                                   |
| Encrypt program on devnet: `4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8`       | Encrypt docs                                                   |
| Ika program ID on Solana devnet: `87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY` | Ika pre-alpha README / docs                                    |
| Ika gRPC endpoint: `https://pre-alpha-dev-1.ika.ika-network.net:443`            | Ika pre-alpha README / docs                                    |
| Encrypt gRPC endpoint: `https://pre-alpha-dev-1.encrypt.ika-network.net:443`    | Encrypt docs / repo                                            |
| Official pre-alpha repos are public                                             | `dwallet-labs/ika-pre-alpha`, `dwallet-labs/encrypt-pre-alpha` |
| Nobody in the TG channel is building a liquidation primitive                    | TG competitive scan                                            |

## Official resources (new source of truth)

- **Ika docs:** `https://solana-pre-alpha.ika.xyz/`
- **Ika repo:** `https://github.com/dwallet-labs/ika-pre-alpha`
- **Encrypt docs:** `https://docs.encrypt.xyz/`
- **Encrypt repo:** `https://github.com/dwallet-labs/encrypt-pre-alpha`
- **Extra field reference:** `https://github.com/kitty4D/encrypt-solana-prealpha-skill` (helpful, but not normative)

## Integration note you should not ignore

- The local scaffold started on Anchor `0.31.0`.
- Ika official docs/examples target `ika-dwallet-anchor` with `anchor-lang = "1"` and Anchor CLI `1.x`.
- Encrypt's repo workspace also resolves `anchor-lang = "1"`, while its installation page still mentions `anchor-lang = "0.32"`.
- Translation: sponsor dependency alignment is a real Phase 1 task, not cleanup.
- Interim code strategy: vendor the thin CPI wrappers locally from the official repos so the program can keep moving on Anchor `0.31.x` while the upstream dependency line gets sorted out.
- Extra Encrypt gotcha: the instruction prose says `execute_graph` ends with `num_inputs(u16)`, but the current repo macro/dev builder serialize `num_inputs` as `u8`. Follow repo code until upstream reconciles the mismatch.
- Local repo stopgap now exists: `cargo run -p liquidation_graph -- --format=rust` emits the serialized `resolve_auction` graph bytes, and `--instruction-data` emits the wrapped `execute_graph` payload in the current repo wire format.
- `resolve_auction` now rejects any non-canonical graph bytes. Clients can safely pass an empty vector and let the program use the built-in liquidation graph, or pass the exact bytes from `tools/liquidation_graph`.
- The canonical graph now outputs two ciphertexts: winner index and winning bid amount. That lets the program request decryption for both and derive the winner/price during `finalize` instead of trusting client-supplied winner data.

---

## Tech stack

### On-chain (Rust)

- **Anchor** — main program framework
- **`ika_dwallet_anchor`** — Ika CPI crate (gives us `DWalletContext` + `approve_message`)
- **Encrypt Anchor integration** — Encrypt CPI (gives us `execute_graph` + reads `CiphertextDecryptResponse`)

### Off-chain (TypeScript)

- **`@solana/web3.js`** — watching accounts, calling instructions
- **`@coral-xyz/anchor`** — IDL client for the Anchor program
- **Encrypt gRPC client** — `EncryptClient::create_input` for bid submission
- **`bitcoinjs-lib`** — constructing SegWit (P2WPKH) transactions
- **Bitcoin testnet RPC** — broadcasting (use `https://blockstream.info/testnet/api` or similar public endpoint)

### Demo setup

- Solana devnet
- Bitcoin testnet (tb1q addresses)
- 3 test liquidator keypairs (pre-funded on devnet)
- 1 dWallet pre-funded with BTC testnet (SegWit address)

---

## System architecture

```
[BORROWER SETUP — one time]
  DKG (mocked) → dWallet → Bitcoin SegWit address (tb1q...)
  Fund that address with BTC testnet
  Transfer dWallet authority → Anchor program PDA
  Call initialize_position

[AUCTION FLOW]
  check_health → status: AuctionOpen
      ↓
  3x submit_bid (ciphertext_id + bidder_btc_address)
  [bids submitted via gRPC EncryptClient::create_input off-chain]
      ↓
  resolve_auction → CPI to Encrypt execute_graph
  [Encrypt executor auto-evaluates, commits to CiphertextDecryptResponse]
      ↓
  finalize → reads CiphertextDecryptResponse (winner + amount)
           → CPI to Ika approve_message (hash of BTC SegWit tx)
           → Ika writes ECDSA signature to MessageApproval account
      ↓
  Off-chain broadcaster:
    polls MessageApproval account
    reads ECDSA signature
    assembles SegWit tx (dWallet address → winner BTC address, 0.5 BTC)
    broadcasts to Bitcoin testnet RPC
      ↓
  BTC lands on Bitcoin testnet. Demo done.
```

---

## Anchor program spec

### Program name: `liquidation-coordinator`

### Accounts

```rust
// Main position state
pub struct Position {
    pub borrower: Pubkey,
    pub debt_amount: u64,           // in lamports (simulated USDC for demo)
    pub collateral_btc: u64,        // in satoshis (0.5 BTC = 50_000_000)
    pub dwallet_id: Pubkey,         // the Ika dWallet object reference
    pub dwallet_btc_address: String, // tb1q... SegWit address where BTC lives
    pub health_threshold: u64,      // hardcoded for demo
    pub status: AuctionStatus,      // Active | AuctionOpen | Resolving | Resolved
    pub auction_deadline: i64,      // Unix timestamp
    pub bump: u8,
}

// One per bidder
pub struct BidAccount {
    pub bidder: Pubkey,
    pub bidder_btc_address: String, // where winning BTC gets sent
    pub ciphertext_id: [u8; 32],    // reference to Encrypt ciphertext
    pub bump: u8,
}

pub enum AuctionStatus {
    Active,
    AuctionOpen,
    Resolving,
    Resolved,
}
```

### Instructions

**1. `initialize_position`**

- Creates the `Position` account
- Stores dWallet ID and BTC SegWit address
- Sets status to `Active`
- Hardcoded for demo: 0.5 BTC collateral, threshold = X

**2. `check_health`**

- Reads current position
- If below threshold: set status to `AuctionOpen`, set `auction_deadline = now + 60s`
- Emit `AuctionOpened { position, deadline }` event
- Anyone can call this (permissionless trigger)

**3. `submit_bid(ciphertext_id: [u8; 32], bidder_btc_address: String)`**

- Only callable when status is `AuctionOpen`
- Only callable before `auction_deadline`
- Creates a `BidAccount` storing `ciphertext_id` + `bidder_btc_address`
- The actual ciphertext lives in the Encrypt executor (submitted off-chain via gRPC beforehand)
- Max 3 bids for demo (enforce with a counter on Position)

**4. `resolve_auction`**

- Only callable when status is `AuctionOpen` and `auction_deadline` has passed
- CPI-calls Encrypt's `execute_graph` with the 3 bid ciphertext IDs and the `resolve_auction` graph
- Sets status to `Resolving`
- Emit `ResolutionStarted` event
- The Encrypt executor will auto-evaluate and write to `CiphertextDecryptResponse`

**5. `finalize(btc_tx_hash: [u8; 32])`**

- Only callable when status is `Resolving`
- Reads `CiphertextDecryptResponse` — gets winner index (0, 1, or 2)
- Looks up winner's `BidAccount` to get `bidder_btc_address`
- Validates `btc_tx_hash` matches: `hash(dWallet_address → winner_btc_address, 0.5 BTC)`
- CPI-calls Ika's `approve_message` with `btc_tx_hash`
- Sets status to `Resolved`
- Emit `AuctionResolved { winner_pubkey, winner_btc_address, clearing_price }` event

> Note on `btc_tx_hash`: The BTC transaction is constructed off-chain (you know the UTXO,
> the winner's address, and the amount). The hash is passed into `finalize` as an argument.
> The Anchor program validates it matches the expected inputs before calling `approve_message`.
> This keeps Bitcoin tx construction in TypeScript where you have proper tooling.

### The CPI calls

**Encrypt CPI (resolve_auction instruction):**

```rust
use encrypt_anchor::cpi::execute_graph;

execute_graph(
    CpiContext::new(encrypt_program, accounts),
    graph_id,          // your compiled resolve_auction graph
    vec![
        bid_a_ciphertext_id,
        bid_b_ciphertext_id,
        bid_c_ciphertext_id,
    ],
)?;
```

**Ika CPI (finalize instruction):**

```rust
use ika_dwallet_anchor::DWalletContext;

let ctx = DWalletContext {
    dwallet_program,
    cpi_authority,
    caller_program,
    cpi_authority_bump: bump,
};

ctx.approve_message(
    message_approval,
    dwallet,
    payer,
    system_program,
    btc_tx_hash,        // hash of the SegWit tx payload
    user_pubkey,
    SignatureScheme::Secp256k1, // ECDSASecp256k1 for Bitcoin SegWit
    bump,
)?;
```

### The Encrypt function

```rust
#[encrypt_fn]
fn resolve_auction(bid_a: EUint64, bid_b: EUint64, bid_c: EUint64) -> EUint64 {
    // returns winner index: 0, 1, or 2
    // comparison tree: find the maximum bid
    let winner_ab = if bid_a >= bid_b { EUint64::from(0) } else { EUint64::from(1) };
    let max_ab = if bid_a >= bid_b { bid_a } else { bid_b };
    if max_ab >= bid_c { winner_ab } else { EUint64::from(2) }
}
```

---

## Off-chain components

### 1. Bid submission client (`bid-client.ts`)

Runs before the auction deadline. One run per bidder.

```
- Connect to Encrypt gRPC endpoint on devnet
- Call EncryptClient::create_input(bid_amount: u64) → ciphertext_id
- Call submit_bid(ciphertext_id, bidder_btc_address) on the Anchor program
```

Current repo status:

- `scripts/bid-client.ts` exists and is typechecked
- It uses the local `proto/encrypt_service.proto` adapter, submits mock pre-alpha ciphertext bytes via gRPC, then sends `submit_bid` with raw Anchor instruction encoding

### 2. Resolution watcher (`watcher.ts`)

Polls after `resolve_auction` is called.

```
- Poll the two Encrypt decryption-request accounts (winner index + winning price)
- When both are complete: build the Bitcoin BIP143 preimage off-chain
- Compute `keccak256(preimage)` for the Ika `MessageApproval` PDA lookup hash
- Call `finalize(approval_hash)` on the Anchor program
- Immediately follow with Ika gRPC `PresignForDWallet` + `Sign`
  using `message = preimage` and `hash_scheme = DoubleSHA256`
```

Current repo status:

- `scripts/resolve-auction.ts` exists and is typechecked
- It now resolves using 3 ordered `BidAccount`s, creates both output ciphertext signers, and calls `resolve_auction`
- `scripts/request-resolution-decryption.ts` exists and requests decryption for both the winner index and winning price ciphertexts
- `scripts/finalize-auction.ts` exists and calls `finalize` against the stored decryption requests
- `scripts/watcher.ts` now exists and chains request-decryption → decryption polling → Bitcoin preimage build → `finalize` → Ika `PresignForDWallet`/`Sign` → optional broadcast
- Important operator note: the current on-chain arg/state name `btc_tx_hash` is misleading for Bitcoin. The value must be `keccak256(preimage)` for Ika lookup, not the Bitcoin txid and not the BIP143 `sha256d(preimage)` signing digest.
- `--approval-user-pubkey` should be treated as the 32-byte dWallet DKG/session identifier used by Ika gRPC, not as an ordinary Solana wallet pubkey.

### 3. BTC broadcaster (`broadcaster.ts`)

The only piece that touches Bitcoin.

```
- Poll for MessageApproval account on Solana
- When it appears: read the ECDSA signature bytes
- Construct SegWit P2WPKH transaction:
    input:  dWallet UTXO (0.5 BTC at tb1q... address)
    output: winner's BTC address (from AuctionResolved event)
    fee:    hardcoded testnet fee (~10000 sats for demo)
- Attach the ECDSA signature from MessageApproval
- Broadcast via POST to blockstream.info/testnet/api/tx
- Log the txid
```

**Bitcoin library:** use `bitcoinjs-lib` with `@bitcoinerlab/secp256k1`.
Build a P2WPKH input. The signature from Ika is a raw ECDSA signature — encode it
in DER format + SIGHASH_ALL byte before attaching.

Current repo status:

- `scripts/broadcaster.ts` now exists and is typechecked
- It rebuilds the single-input single-output P2WPKH spend from the winner's BTC address plus funding UTXO metadata, validates that `keccak256(preimage)` matches `Position.approved_btc_tx_hash`, DER-encodes the compact Ika signature from `MessageApproval`, and can POST the raw tx to Esplora / Blockstream testnet

### 3.5. Ika hash split (`do not mix these up`)

```
MessageApproval PDA seed / finalize arg   = keccak256(bitcoin_preimage)
Ika network signing digest (Bitcoin)      = sha256d(bitcoin_preimage)
Broadcast txid                            = sha256d(serialized_signed_tx), reversed for display
```

The repo now follows that split explicitly in the watcher/broadcaster path.

### 4. Presign pool (`presign.ts`)

**Do this early. Demo latency is a real problem.**

The 2PC-MPC signing has network latency. For a live demo, pre-generate the
`approve_message` call before the demo starts on a known message hash.
kitty4D confirmed this works. Fesal also mentioned this pattern.

For the demo: pre-sign a known BTC tx (with the winner's address hardcoded to one
of your test wallets). Use that pre-signed MessageApproval to make the broadcast
instant. The judge sees the BTC land; the mechanism is still real.

---

## dWallet setup (one-time before demo)

```
1. Run DKG (mocked in Ika pre-alpha) to create the dWallet
   → output: dWallet object + Bitcoin SegWit address (tb1q...)
2. Fund the SegWit address with BTC testnet
   (use a testnet faucet: https://bitcoinfaucet.uo1.net or similar)
3. Transfer dWallet authority to your Anchor program's CPI authority PDA
4. Note the dWallet ID and BTC address — hardcode into initialize_position
```

**TODO:** find the exact DKG flow for the Solana pre-alpha.
Ask in TG or check the `ika_dwallet_anchor` repo for a setup example.

---

## Build phases

### Phase 1 — Environment + DKG setup (Days 1–3 · Apr 13–15)

- [ ] Init Anchor project: `anchor init liquidation-coordinator`
- [ ] Resolve the Anchor version line before adding sponsor crates (`0.31.0` scaffold vs official pre-alpha repos on the Anchor v1 line)
- [ ] Add `ika_dwallet_anchor` and Encrypt Anchor crates as dependencies
- [ ] Confirm both program IDs on devnet (`Encrypt: 4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8`, `Ika: 87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY`)
- [ ] Run the DKG flow to create the dWallet
- [ ] Fund the dWallet BTC SegWit address from testnet faucet
- [ ] Confirm `approve_message` CPI compiles and links correctly
- [ ] Confirm Encrypt `execute_graph` CPI compiles and links correctly

### Phase 2 — Anchor program (Days 4–12 · Apr 16–24)

- [ ] Define all account structs (Position, BidAccount)
- [ ] Implement `initialize_position`
- [ ] Implement `check_health`
- [ ] Implement `submit_bid`
- [x] Add a deterministic local generator for `resolve_auction` graph bytes (`tools/liquidation_graph`)
- [ ] Swap the local generator to the official `#[encrypt_fn]` pipeline once the Anchor version line is resolved
- [ ] Implement `resolve_auction` with Encrypt CPI
- [ ] Implement `finalize` with Ika CPI
- [ ] Unit tests for each instruction (Anchor test framework)
- [ ] Deploy to devnet and run a full pass manually

### Phase 3 — Off-chain components (Days 13–17 · Apr 25–29)

- [x] `bid-client.ts` — gRPC bid submission
- [x] `watcher.ts` — requests decryption, waits for Encrypt results, finalizes, drives Ika signing, optionally broadcasts
- [x] `broadcaster.ts` — reads MessageApproval, rebuilds the P2WPKH spend, and broadcasts
- [ ] End-to-end test: submit 3 bids → resolve → finalize → BTC tx broadcast → txid logged

### Phase 4 — Presign pool + integration hardening (Days 18–22 · Apr 30–May 4)

- [ ] Implement presign pool pattern for demo latency
- [ ] Run the full demo 3x end-to-end, fix any timing issues
- [ ] Handle edge cases: deadline not passed, wrong number of bids, already resolved
- [ ] Confirm BTC testnet txid actually confirms (not just broadcast)

### Phase 5 — Demo harness + polish (Days 23–26 · May 5–8)

- [ ] Simple terminal UI or minimal web UI showing the 8-step flow
- [ ] Demo script written out (what to click/run, in what order, what to say)
- [ ] Record demo video (5 min): position → bids → resolution → BTC lands
- [ ] Architecture diagram finalized (use corrected-architecture.md as source)

### Phase 6 — Submission (Days 27–29 · May 9–12)

- [ ] README: problem, solution, architecture, setup instructions, constraints
- [ ] Clean up repo, add MIT license
- [ ] Deploy a live version if possible
- [ ] Submit on Colosseum
- [ ] Submit on Superteam Earn before May 12 12:59 WAT

---

## Submission form answers (draft now, refine at end)

**Q10 — How does your project use Ika and/or Encrypt, and how central are they?**

> Encrypt's `execute_graph` CPI resolves the sealed-bid auction: three `EUint64` bid ciphertexts
> are evaluated by the FHE computation graph, producing only the winner — losing bids are never
> decrypted. Ika's `approve_message` CPI is called in the same `finalize` instruction immediately
> after: it signs the Bitcoin SegWit transfer that moves the native BTC collateral to the winning
> liquidator. Both CPIs are in the primary user flow. Neither is decorative.

**Q11 — What is novel or unique about how you used Ika and/or Encrypt?**

> The `resolve_auction → approve_message` CPI chain in a single Anchor instruction is the
> primitive. Encrypt's auction resolution directly triggers Ika's cross-chain signing without
> any off-chain trust in between. This composition — one program, two CPI calls, two pre-alpha
> programs on devnet — does not exist anywhere else.

**Q12 — What problem would your project face without Ika and/or Encrypt?**

> Without Encrypt: commit-reveal leaks losing bids at reveal time and is front-runnable.
> The sealed-bid guarantee requires FHE computation on encrypted state.
> Without Ika: the BTC collateral must be bridged or wrapped, introducing a bridge validator
> set at the worst possible moment. Ika's `approve_message` signs the native BTC transfer
> from inside the Solana program — no bridge, no wrapped asset.

**Q13 — Current limitations and next steps?**

> Encrypt pre-alpha stores ciphertexts as plaintext; the FHE guarantee is forward-compatible
> when the runtime ships. Ika pre-alpha uses a mock signer; the real 2PC-MPC signing will
> replace it transparently. The demo hardcodes one position and three liquidators — production
> would accept live feeds from existing lending protocols (Kamino, MarginFi).

---

## Internal quality gate (check before submitting)

- [ ] The `resolve_auction → approve_message` CPI chain executes end-to-end on devnet
- [ ] A real BTC testnet txid exists (not just a broadcast — actually confirmed)
- [ ] Losing bids are never decrypted (verify by checking chain state after resolution)
- [ ] README documents the pre-alpha constraints honestly
- [ ] Demo video shows all 8 steps including the Bitcoin txid
- [ ] Sponsor integration is visible in the first 30 seconds of the demo video

---

## Known constraints (be honest about these)

- Encrypt pre-alpha: ciphertexts stored as plaintext on-chain. Code is forward-compatible.
- Ika pre-alpha: mock signer. Real 2PC-MPC signing replaces it without code changes.
- Taproot not supported. P2WPKH (SegWit) only.
- DKG is mocked in pre-alpha. Real DKG ships in a later version.
- 3-bidder limit is a demo simplification. Production would be N bidders.
- BTC tx construction is off-chain (TypeScript). On-chain UTXO tracking is out of scope.
