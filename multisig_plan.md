# Clear Multisig + Ika + Encrypt — Implementation Plan
## Second submission for the Encrypt & Ika Frontier Track
### Deadline: May 12 2026 · Built on Fesal's POC

---

## The pitch in one sentence

> A multisig where signers always see exactly what they're approving (clear intents),
> governance rules stay private (Encrypt encrypted policies), and one wallet controls
> assets natively across Solana, Ethereum, and Bitcoin — no bridges, no blind signing,
> no more Bybit-style hacks.

---

## Foundation — Fesal's POC (do not rebuild this)

Fesal publicly asked someone to turn this into a product. He built the hard parts.
You are building the product layer on top.

**Repo:** `https://github.com/Iamknownasfesal/clear-msig-ika`

**Clone it:**
```bash
git clone https://github.com/Iamknownasfesal/clear-msig-ika
cd clear-msig-ika
```

**What already exists — do not touch:**
- Full on-chain Quasar program (`programs/clear-wallet/`)
- `propose → approve → execute` lifecycle
- `ika_sign` instruction — CPIs Ika `approve_message`, drives cross-chain signing
- Chain preimage builders: `evm_1559`, `evm_1559_erc20`, `bitcoin_p2wpkh` (BTC SegWit)
- `DwalletOwnership` lock (security: one wallet per dWallet, cannot be hijacked)
- Full CLI (`cli/`) with broadcast support and Ledger hardware wallet integration
- Blog (`blog.md`) — the problem statement. Read it. It's your pitch.
- Example intent JSONs (`examples/intents/`)

**What the POC does NOT have (your job):**
- Web UI
- Policy engine (Encrypt encrypted policies)
- Multi-chain portfolio dashboard
- Intent template marketplace
- Notifications
- Squads import

---

## The problem (internalize this before every conversation about the product)

**Bybit lost $1.4 billion. Drift got exploited. Ledger hardware wallets didn't help.**

The actual root cause: nobody knows what they're signing. The hardware wallet shows a
hash. The UI renders it for you. If the UI is compromised (Bybit's was), you sign what
the attacker wants, not what you think you're signing.

Fesal's insight: instead of making transactions human-readable (hard, fragile), define
an explicit list of human-readable *intents* that the multisig can perform. Signers sign
a human-readable message:

```
expires 2026-05-01 10:00:00: approve transfer 1.5 ETH to 0xdEaD... | wallet: treasury proposal: 42
```

The message on the Ledger screen IS the transaction. No UI can lie about it.

Your additions:
- **Encrypt policies**: the governance rules enforcing WHAT those intents can do
  stay private on-chain. Spending limits, daily caps, recipient restrictions —
  encrypted via Encrypt, enforced by the chain, invisible to attackers.
- **Ika cross-chain**: the same wallet that governs your Solana treasury also
  controls your native ETH and native BTC. One multisig, all chains.

---

## Official resources (bookmark all of these)

| Resource | URL |
|---|---|
| Fesal's POC repo | `https://github.com/Iamknownasfesal/clear-msig-ika` |
| Quasar framework | `https://github.com/blueshift-gg/quasar` |
| Ika Solana pre-alpha docs | `https://solana-pre-alpha.ika.xyz/` |
| Ika pre-alpha repo | `https://github.com/dwallet-labs/ika-pre-alpha` |
| Encrypt docs | `https://docs.encrypt.xyz/` |
| Encrypt pre-alpha repo | `https://github.com/dwallet-labs/encrypt-pre-alpha` |
| Ika program ID (devnet) | `87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY` |
| Encrypt program ID (devnet) | `4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8` |
| Ika gRPC endpoint | `https://pre-alpha-dev-1.ika.ika-network.net:443` |
| Encrypt gRPC endpoint | `https://pre-alpha-dev-1.encrypt.ika-network.net:443` |
| kitty4D's reference | `https://github.com/kitty4D/encrypt-solana-prealpha-skill` |
| Fesal's tweet | (the tweet you shared — forward this to team) |

---

## Tech stack

### On-chain (extending the POC)
- **Quasar** — the POC's framework. NOT standard Anchor. Read the Quasar docs before touching the program.
- **Agave v3.1+** — required by Quasar. Install: `agave-install init 3.1.12`
- **Encrypt Quasar/Pinocchio integration** — call `execute_graph` CPI from the Quasar program
- **Ika CPI** — already implemented in `programs/clear-wallet/src/utils/ika_cpi.rs`. Don't rewrite it.

### Off-chain (new build)
- **Next.js 14** (App Router) — web UI framework
- **Tailwind CSS + shadcn/ui** — component library for fast professional UI
- **`@solana/wallet-adapter`** — Phantom, Backpack, Solflare, Ledger
- **`@solana/web3.js`** — account reading, instruction building, polling
- **Encrypt gRPC client** — `EncryptClient::create_input` for creating policy ciphertexts
- **`viem`** — ETH balance lookup and address derivation from dWallet pubkey
- **`bitcoinjs-lib`** — BTC SegWit address derivation from dWallet pubkey
- **Blockstream API** — BTC balance: `https://blockstream.info/testnet/api/address/{addr}`
- **Infura/Alchemy or public RPC** — ETH balance on Sepolia

### Setup requirements
```bash
# Agave (required for Quasar)
agave-install init 3.1.12

# Quasar CLI
cargo install --git https://github.com/blueshift-gg/quasar quasar-cli

# Node
pnpm install  # or npm install
```

---

## Architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    WEB UI (Next.js)                             │
│                                                                 │
│  Dashboard   Intent Builder   Proposal Flow   Portfolio View    │
│      │              │               │               │           │
│      └──────────────┴───────────────┴───────────────┘           │
│                              │                                  │
│                     Solana Wallet Adapter                       │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  CLEAR-WALLET       │
                    │  Quasar Program     │
                    │  (Fesal's POC +     │
                    │   your additions)   │
                    │                     │
                    │  + PolicyAccount    │
                    │  + add_policy ix    │
                    │  + execute_graph    │
                    │    CPI in ika_sign  │
                    └────────┬────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
       ┌────────────┐ ┌────────────┐ ┌────────────┐
       │  ENCRYPT   │ │    IKA     │ │  SOLANA    │
       │  Program   │ │  dWallet   │ │  Vault PDA │
       │  devnet    │ │  Program   │ │            │
       │            │ │  devnet    │ │  SOL + SPL │
       │ Policy     │ │            │ │  tokens    │
       │ check via  │ │ approve_   │ │            │
       │ FHE graph  │ │ message    │ │            │
       └────────────┘ └─────┬──────┘ └────────────┘
                            │
               ┌────────────┼───────────────┐
               ▼            ▼               ▼
        ┌───────────┐ ┌──────────┐ ┌─────────────┐
        │ ETHEREUM  │ │  BITCOIN │ │ OTHER CHAINS │
        │ Sepolia   │ │ Testnet  │ │ (roadmap)    │
        │           │ │          │ │              │
        │ Native ETH│ │ Native   │ │              │
        │ ERC-20    │ │ BTC      │ │              │
        └───────────┘ └──────────┘ └─────────────┘
```

---

## What you're adding to the POC

### MVP additions (must ship)

#### 1. PolicyAccount state

New PDA: `["policy", wallet_pubkey, &[intent_index]]`

```rust
// Add to programs/clear-wallet/src/state/
pub struct PolicyAccount {
    pub wallet: Address,
    pub intent_index: u8,
    pub policy_type: PolicyType,
    // Encrypt ciphertext ID for the policy parameters
    // (e.g., max_amount stored as EUint64 ciphertext)
    pub ciphertext_id: [u8; 32],
    // Optional: ciphertext ID for a secondary param
    // (e.g., daily velocity cap as a second EUint64)
    pub secondary_ciphertext_id: Option<[u8; 32]>,
    pub is_active: bool,
    pub bump: u8,
}

pub enum PolicyType {
    SpendingLimit = 0,     // max amount per transaction (MVP)
    DailyVelocity = 1,     // max cumulative per 24h (stretch)
    RecipientWhitelist = 2, // only approved destination addresses (stretch)
    TimeWindow = 3,        // only execute within a time range (stretch)
}
```

#### 2. `add_policy` instruction

```rust
// New instruction: add_policy(intent_index, policy_type, ciphertext_id)
// PDA: ["policy", wallet, &[intent_index]]
// Authority: only the wallet's AddIntent proposers can call this
// (reuses the existing AddIntent governance flow for safety)

pub fn add_policy(
    ctx: Context<AddPolicy>,
    intent_index: u8,
    policy_type: PolicyType,
    ciphertext_id: [u8; 32],
    secondary_ciphertext_id: Option<[u8; 32]>,
) -> Result<()> {
    // Create PolicyAccount PDA
    // Verify caller is an authorized proposer on the wallet
    // Store ciphertext_id — this is the Encrypt-created ciphertext
    // for the max spending amount, stored as EUint64
}
```

#### 3. Policy check inside `ika_sign`

This is the core Encrypt integration. Before the existing `approve_message` CPI in
`ika_sign`, add:

```rust
// In programs/clear-wallet/src/instructions/ika_sign.rs
// After verifying proposal is Approved and timelock elapsed,
// BEFORE calling ctx.ika_cpi().approve_message(...)

if let Some(policy) = PolicyAccount::try_load(&ctx.accounts.policy_account) {
    if policy.is_active {
        // 1. Create a ciphertext for the proposed amount
        //    (passed in as proposal_amount_ciphertext_id from the instruction)
        // 2. CPI to Encrypt execute_graph:
        //    execute_graph(
        //        CHECK_SPENDING_LIMIT_GRAPH_ID,
        //        &[proposal_amount_ciphertext_id, policy.ciphertext_id]
        //    )
        // 3. CPI to Encrypt: request decryption of the result
        // 4. Read CiphertextDecryptResponse — if result != 1, reject
        encrypt_cpi::execute_graph(
            ctx.accounts.encrypt_program.to_account_info(),
            CHECK_SPENDING_LIMIT_GRAPH_ID,
            vec![proposal_ciphertext_id, policy.ciphertext_id],
        )?;
        // Execution continues only if policy passes
    }
}

// Existing ika CPI call stays here
ctx.ika_cpi().approve_message(...)?;
```

#### 4. The Encrypt policy graph

```rust
// Compile this as a separate Encrypt function
// Graph ID stored as a constant in the program

#[encrypt_fn]
fn check_spending_limit(proposed_amount: EUint64, max_amount: EUint64) -> EUint64 {
    // Returns 1 if proposed_amount <= max_amount, else 0
    if proposed_amount <= max_amount {
        EUint64::from(1)
    } else {
        EUint64::from(0)
    }
}
```

#### 5. Web UI (Next.js)

Five screens:

**Screen 1 — Dashboard**
- List all wallets connected to your Solana address
- Per wallet: name, vault balance (SOL), # of intents, # of open proposals
- Quick actions: Create Wallet, View Proposals

**Screen 2 — Wallet Detail**
- Intent list with status (active/disabled) and policy indicator (locked icon if policy active)
- Proposal list: open, pending approval, executed
- Cross-chain addresses: derived ETH address, derived BTC SegWit address
- Per-chain balance shown (pull from Blockstream + Infura)

**Screen 3 — Intent Builder**
- Visual form for creating a custom intent
- Parameter definition (name, type, template string)
- Governance settings (proposers, approvers, threshold, timelock)
- Policy section: enable spending limit → input max amount → encrypt via gRPC → store ciphertext_id
- Preview: shows what the human-readable message will look like

**Screen 4 — Proposal Flow**
- Create proposal: fill in intent params, preview the human-readable message
- Approve: shows the exact message the signer will sign (same as what Ledger displays)
- Approval status: visual bitmap of who approved
- Execute: once threshold met — for cross-chain, triggers ika_sign + broadcast in one button

**Screen 5 — Portfolio / Multi-chain View**
- Unified view: Solana vault + ETH dWallet address + BTC dWallet address
- Balances in USD using CoinGecko for price feeds
- Recent cross-chain transactions (pull from Blockstream + Etherscan APIs)

---

### Stretch features (build these if you finish early)

#### Stretch 1 — Private proposals (encrypted amounts)

Currently, proposal amounts are plaintext in the proposal account — anyone can see
how much is being transferred. Add optional encryption for proposal amounts:

When creating a proposal, the proposer also calls Encrypt gRPC `create_input(amount)`
to get a `proposal_amount_ciphertext_id`. Both are stored in the proposal:
- `plaintext_amount` — for human-readable display to signers (decryptable by them)
- `amount_ciphertext_id` — for the Encrypt policy comparison graph

The policy graph then compares two ciphertexts entirely in encrypted state:

```rust
#[encrypt_fn]
fn check_spending_limit(proposed_amount: EUint64, max_amount: EUint64) -> EUint64 {
    if proposed_amount <= max_amount { EUint64::from(1) } else { EUint64::from(0) }
}
```

Result: nobody on-chain sees the proposed amount OR the policy limit. The FHE graph
confirms the transaction is within policy without revealing either value.
This is the most impressive Encrypt use — both inputs are confidential.

#### Stretch 2 — Daily velocity tracking

A second policy type: `DailyVelocity`. Instead of a per-transaction limit, this
enforces a rolling 24-hour cumulative spending cap.

New state:
```rust
pub struct VelocityTracker {
    pub wallet: Address,
    pub intent_index: u8,
    pub daily_limit_ciphertext_id: [u8; 32],  // Encrypt: max daily spend
    pub spent_today: u64,                       // plaintext running total
    pub window_start: i64,                      // Unix timestamp of window open
    pub bump: u8,
}
```

At `ika_sign` time:
1. Check if 24h window has reset — if `now > window_start + 86400`, reset `spent_today = 0`
2. CPI to Encrypt: compare `spent_today + proposed_amount <= daily_limit`
3. If passes: update `spent_today += proposed_amount`
4. Then proceed with `approve_message`

This is the pattern institutional treasury desks actually use. Very impressive for the judges.

#### Stretch 3 — Recipient whitelist policy

An intent can restrict the destination address to a pre-approved list. The whitelist
is stored as a Merkle root on-chain (can be plaintext — the root reveals nothing about
the addresses). At execute time, the proposer provides a Merkle proof, the program
verifies the destination is in the whitelist.

```rust
pub struct WhitelistPolicy {
    pub wallet: Address,
    pub intent_index: u8,
    pub merkle_root: [u8; 32],  // root of the approved address Merkle tree
    pub bump: u8,
}
// At execute: verify Merkle proof that destination is in the tree
```

No Encrypt needed here — Merkle proofs are efficient and don't need FHE.
But it's a powerful policy type that real DAOs want.

#### Stretch 4 — Intent template marketplace

A curated library of pre-built intent JSON templates that any DAO can import.
Ship these as a static JSON registry in the repo + a UI screen:

Templates to build:
```
SOL transfer             — already in examples/
ETH transfer (Sepolia)   — already in examples/
ERC-20 transfer          — already in examples/
BTC SegWit transfer      — already in examples/
Drift: add market        — new
Drift: update params     — new
Kamino: adjust LTV       — new
Token swap intent        — new
Upgrade program buffer   — new (high value for protocol multisigs)
Rotate admin key         — new
```

UI: "Browse Templates" screen. One click to import a template as a new intent.
The governance params (proposers, approvers, threshold) are filled in separately.

This is a massive UX win for DAOs — they don't need to write intent JSON by hand.

#### Stretch 5 — Hardware wallet UX in the browser

The CLI already supports Ledger (`--signer-ledger`). Bring this to the web UI.

For the multisig signing step (approving a proposal), the signer signs a
human-readable message — NOT a transaction. This maps perfectly to Ledger's
`signMessage` support in the Solana app.

Use `@solana/wallet-adapter-ledger`. The approve button triggers a `signMessage`
call. The Ledger screen shows:

```
expires 2026-05-12 10:00:00: approve transfer 1.5 ETH to 0xdEaD...
```

The judge can literally try it with their Ledger in the browser during the demo.
This is the most powerful live demo moment you have — it concretely shows the problem
is solved because what appears on the Ledger screen IS the transaction.

#### Stretch 6 — Squads member import

DAOs that already have a Squads multisig can import their member list.
Read the Squads PDA structure, extract current members + threshold, and
pre-populate the "Create Wallet" form. One click to migrate.

```typescript
// Read existing Squads vault
const squadsVault = await fetchSquadsMembers(squadsAddress);
// Pre-populate the clear-msig wallet creation form
setProposers(squadsVault.members);
setThreshold(squadsVault.threshold);
```

This is a genuine growth vector: every Squads user is a potential migrator.

#### Stretch 7 — Proposal notifications

When a new proposal is created against an intent that requires your approval,
notify you automatically. Options:
- **Telegram bot**: user provides their Telegram username at wallet creation,
  bot sends DM when proposals need their vote
- **Email**: simple Resend webhook on-chain event listener

Implementation:
- Small Node.js server (or Vercel Edge Functions) that subscribes to Solana
  program logs for `ProposalCreated` events
- On event: lookup the intent's approver list, send notifications to registered contacts
- ~150 lines total

#### Stretch 8 — Policy templates gallery

Pre-configured policy bundles that DAOs can apply to an intent in one click:

```
Conservative DAO:
  SpendingLimit: 1 ETH per tx
  DailyVelocity: 5 ETH per day
  RecipientWhitelist: pre-approved addresses only

Active Treasury:
  SpendingLimit: 50 ETH per tx
  DailyVelocity: 200 ETH per day
  No whitelist

Emergency Operations:
  SpendingLimit: 500 ETH per tx
  Requires 4/5 signers (override governance)
  No velocity cap
```

The policy template creates the correct Encrypt ciphertexts automatically.
The signer just picks a template and the encryption happens in the background.

#### Stretch 9 — Encrypted audit trail

Every executed cross-chain proposal stores its payload encrypted as an Encrypt
ciphertext event. Wallet signers (who have the decryption authority) can pull
a full treasury activity history and decrypt it for reporting. Non-signers see
only timestamps and proposal IDs.

This is the privacy-preserving treasury accounting feature that every serious
DAO needs but nobody has built yet.

---

## Build phases and timeline

**Total time remaining: ~29 days (Apr 13 – May 12)**

### Phase 1 — Orientation + setup (Days 1–3 · Apr 13–15)

- [ ] Clone the POC: `git clone https://github.com/Iamknownasfesal/clear-msig-ika`
- [ ] Install Agave v3.1.12: `agave-install init 3.1.12`
- [ ] Install Quasar CLI: `cargo install --git https://github.com/blueshift-gg/quasar quasar-cli`
- [ ] Run the existing test suite: `cargo test` — understand what passes
- [ ] Build the program: `cd programs/clear-wallet && quasar build`
- [ ] Deploy to localnet and walk through the full CLI demo in the README end-to-end
- [ ] Read `blog.md`, `programs/clear-wallet/src/instructions/ika_sign.rs`,
      `programs/clear-wallet/src/utils/ika_cpi.rs`, and `programs/clear-wallet/src/state/`
- [ ] Understand exactly where in `ika_sign` the Encrypt CPI hook will go

### Phase 2 — Encrypt policy integration (Days 4–10 · Apr 16–22)

- [ ] Add `PolicyAccount` state struct to the Quasar program
- [ ] Implement `add_policy` instruction
- [ ] Write `check_spending_limit` Encrypt FHE graph (`#[encrypt_fn]`)
- [ ] Compile the FHE graph, note the graph ID
- [ ] Add Encrypt `execute_graph` CPI call to `ika_sign` before `approve_message`
- [ ] Read `CiphertextDecryptResponse` account in `ika_sign`, validate result
- [ ] Test: create an intent with a spending limit policy, submit a proposal
      that exceeds it, confirm `ika_sign` rejects it
- [ ] Test: submit a proposal within the limit, confirm it proceeds to `approve_message`
- [ ] If ahead of schedule: implement `DailyVelocity` policy (Stretch 2)

### Phase 3 — Web UI core (Days 11–18 · Apr 23–30)

- [ ] `npx create-next-app@latest clear-msig-ui --typescript --tailwind --app`
- [ ] Install wallet adapter: `@solana/wallet-adapter-react`, `@solana/wallet-adapter-wallets`
- [ ] Install shadcn/ui: `npx shadcn@latest init`
- [ ] Build Screen 1: Dashboard (wallet list, create wallet form)
- [ ] Build Screen 2: Wallet Detail (intent list, proposal list)
- [ ] Build Screen 3: Intent Builder (form, policy section, Encrypt gRPC call for ciphertext)
- [ ] Build Screen 4: Proposal Flow (create, approve, status bitmap, execute button)
- [ ] Wire all screens to the Quasar program via direct `@solana/web3.js` instruction calls
      (Quasar IDL may not match Anchor exactly — build instruction builders manually)
- [ ] Polish: loading states, error handling, empty states, mobile layout

### Phase 4 — Cross-chain UX + portfolio (Days 19–23 · May 1–5)

- [ ] Add `wallet add-chain` flow to the UI (bind dWallet to ETH + BTC)
- [ ] Derive ETH address from dWallet pubkey: `keccak256(pubkey_uncompressed)[12:]`
- [ ] Derive BTC SegWit address from dWallet pubkey: P2WPKH(SECP256K1 pubkey)
- [ ] Build Screen 5: Portfolio view
  - Solana vault balance via `@solana/web3.js`
  - ETH balance via `viem` + public Sepolia RPC
  - BTC balance via `blockstream.info/testnet/api/address/{addr}`
  - USD values via CoinGecko API
- [ ] Cross-chain execute: wire the execute button to trigger `ika_sign` +
      broadcast to ETH Sepolia in one click
- [ ] Show ETH txid on Etherscan + BTC txid on Blockstream after broadcast

### Phase 5 — Stretch features (Days 24–26 · May 6–8)

Pick the ones that improve demo impact most, in order:
- [ ] Ledger signMessage support in the browser (Stretch 5) — most impressive demo moment
- [ ] Intent template marketplace (Stretch 4) — easiest, highest UX value
- [ ] Private proposals (Stretch 1) — most impressive Encrypt use
- [ ] Recipient whitelist policy (Stretch 3) — real DAO feature
- [ ] Squads import (Stretch 6) — growth vector

### Phase 6 — Submission (Days 27–29 · May 9–12)

- [ ] README: problem, architecture, how to run, honest pre-alpha constraints
- [ ] Demo video (5 min):
  1. Open dashboard — show Solana vault, ETH address, BTC address all in one view
  2. Create an intent (ETH transfer) with an Encrypt spending limit policy
  3. Create a proposal that exceeds the limit — show it gets rejected
  4. Create a proposal within the limit — show it gets approved
  5. Execute: Encrypt policy check ✓ → Ika sign ✓ → ETH tx broadcasts → Etherscan confirms
  6. Show the Ledger screen (if Stretch 5 is done)
- [ ] Deploy UI to Vercel
- [ ] Submit on Colosseum + Superteam Earn

---

## On-chain hook point (exactly where to put the Encrypt CPI)

Open `programs/clear-wallet/src/instructions/ika_sign.rs`. Find where
`ctx.ika_cpi().approve_message(...)` is called. Your Encrypt policy check
goes immediately before that call:

```rust
// ... existing approval checks (timelock, status, ownership) ...

// === YOUR ADDITION STARTS HERE ===
if let Ok(policy) = PolicyAccount::try_deserialize(&mut ctx.accounts.policy_account.data.borrow().as_ref()) {
    if policy.is_active {
        // 1. CPI to Encrypt execute_graph
        let cpi_accounts = ExecuteGraph {
            caller: ctx.accounts.caller.to_account_info(),
            encrypt_program: ctx.accounts.encrypt_program.to_account_info(),
        };
        encrypt_cpi::execute_graph(
            CpiContext::new(ctx.accounts.encrypt_program.to_account_info(), cpi_accounts),
            CHECK_SPENDING_LIMIT_GRAPH_ID,
            vec![
                ctx.accounts.proposal_ciphertext_id,  // proposed amount (EUint64)
                policy.ciphertext_id,                 // max allowed (EUint64)
            ],
        )?;

        // 2. Wait for Encrypt executor to write CiphertextDecryptResponse
        //    (in demo: pre-run this, or poll off-chain before calling finalize)
        let result = CiphertextDecryptResponse::try_deserialize(
            &mut ctx.accounts.decrypt_response.data.borrow().as_ref()
        )?;

        // 3. Reject if policy check fails (result != 1)
        require!(result.value == 1, ClearWalletError::PolicyViolation);
    }
}
// === YOUR ADDITION ENDS HERE ===

// Existing Ika CPI — unchanged
ctx.ika_cpi().approve_message(
    ctx.accounts.message_approval.to_account_info(),
    ctx.accounts.dwallet.to_account_info(),
    // ... rest of existing args
)?;
```

---

## UI component map

```
app/
  layout.tsx                 — wallet adapter provider, nav
  page.tsx                   — redirect to /dashboard
  dashboard/
    page.tsx                 — Screen 1: wallet list
  wallet/[address]/
    page.tsx                 — Screen 2: wallet detail
    intents/new/page.tsx     — Screen 3: intent builder
    proposals/[id]/page.tsx  — Screen 4: proposal detail + approve
  portfolio/page.tsx         — Screen 5: multi-chain view

components/
  WalletCard.tsx             — wallet summary card
  IntentCard.tsx             — intent with policy badge
  ProposalCard.tsx           — proposal with approval bitmap
  ApprovalBitmap.tsx         — visual grid of approvers/status
  PolicyBadge.tsx            — locked icon + policy type
  ChainBalance.tsx           — single chain balance row
  ExecuteButton.tsx          — handles ika_sign + broadcast flow
  LedgerSignModal.tsx        — Ledger signMessage flow (stretch)

lib/
  program.ts                 — instruction builders for clear-wallet program
  encrypt.ts                 — gRPC client for create_input
  chains.ts                  — ETH/BTC address derivation + balance fetching
  policies.ts                — policy creation, ciphertext management
```

---

## Submission form answers (draft)

**Q10 — How does your project use Ika and/or Encrypt, and how central are they?**
> Ika is the cross-chain execution layer. Every custom intent that targets Ethereum or Bitcoin
> goes through the `ika_sign` instruction — the clear-wallet program CPIs Ika's `approve_message`,
> which drives a 2PC-MPC signature that moves native ETH or BTC without bridges or wrapped assets.
>
> Encrypt is the private policy enforcement layer. Each intent can have an encrypted spending limit
> stored as an `EUint64` ciphertext. When a proposal executes, `ika_sign` calls Encrypt's
> `execute_graph` with the proposed amount and the policy max — the FHE comparison happens
> on encrypted state, and `approve_message` is only called if the policy passes. Neither the
> policy limit nor the proposed amount is ever visible on-chain in plaintext.
>
> Both are in the critical path of every cross-chain execution. Neither is decorative.

**Q11 — What is novel or unique?**
> The `execute_graph → approve_message` composition inside a single `ika_sign` instruction
> is the primitive: Encrypt enforces the governance policy privately, Ika executes the
> cross-chain settlement, all from one Solana program without any off-chain trust.
>
> Built on top of Fesal's clear-msig-ika POC (which he publicly invited teams to build on),
> we added the encrypted policy engine, the web UI, and the multi-chain portfolio view.

**Q12 — What problem without Ika and/or Encrypt?**
> Without Ika: cross-chain assets must be bridged or wrapped. Bridges have lost billions.
> Native ETH and BTC custody from a Solana multisig requires Ika's 2PC-MPC dWallets.
>
> Without Encrypt: spending policies are plaintext on-chain. An attacker who sees a policy
> of "max 50 ETH per tx" knows exactly how to drain the treasury incrementally. Encrypt
> lets policies be enforced by the chain while remaining invisible to everyone except
> authorized signers.

**Q13 — Limitations and next steps?**
> Encrypt pre-alpha stores ciphertexts as plaintext. Code is forward-compatible with the
> FHE runtime. Ika pre-alpha uses a mock signer. Two on-chain programs, both pre-alpha,
> integrated in production for the first time together in one instruction.
>
> Next steps: audited and immutable program (Fesal mentioned this in the blog), Squads
> compatibility, more policy types (velocity, whitelist), more destination chains.

---

## Known constraints

- Quasar requires Agave v3.1+ — install before anything else
- `proposal cleanup` instruction is broken in localnet (known Quasar issue, documented in POC README) — don't demo cleanup
- Encrypt pre-alpha: ciphertexts are plaintext. State this clearly in the demo and README.
- Ika pre-alpha: mock signer. Real 2PC-MPC signing replaces it without code changes.
- Quasar IDL format may differ from standard Anchor IDL — build instruction callers manually in TypeScript instead of using `@coral-xyz/anchor`
- The POC blog (`blog.md`) references @DriftProtocol and Bybit — good for context but don't claim these specific hacks are solved by your POC. Say the category of attack is addressed.

---

## Demo script (practice this)

**Opening (30 sec):**
"Bybit lost $1.4 billion because their signers couldn't verify what they were actually signing.
We're building the fix — a multisig where every signer sees exact human-readable text on their
hardware wallet, policies are enforced privately by Encrypt's FHE, and the same wallet controls
assets natively on Solana, Ethereum, and Bitcoin through Ika."

**Demo beat 1 — Dashboard (1 min):**
Open the UI. Show a wallet with three chains — Solana vault balance, ETH dWallet address with balance, BTC SegWit address with balance. One wallet, three chains.

**Demo beat 2 — Encrypted policy (1.5 min):**
Click "Add Policy" on the ETH transfer intent. Enter 1 ETH as the spending limit.
The UI calls Encrypt gRPC `create_input`, gets a ciphertext_id, calls `add_policy` on-chain.
The policy badge appears. "The limit is now enforced on-chain. Nobody can read it."

**Demo beat 3 — Policy rejection (1 min):**
Create a proposal: transfer 2 ETH (exceeds the 1 ETH limit).
Hit execute. The `ika_sign` instruction calls `execute_graph`, Encrypt checks the policy,
returns 0. The transaction is rejected. "The chain enforced the policy without ever
revealing the limit."

**Demo beat 4 — Successful cross-chain execution (1.5 min):**
Create a proposal: transfer 0.5 ETH (within limit).
Approve it with hardware wallet (Ledger screen shows the human-readable message).
Hit execute. `execute_graph` returns 1 (passes). `approve_message` fires.
The Ika mock signer produces the signature. The broadcaster assembles the EIP-1559 tx.
Switch to Etherscan Sepolia — the ETH lands. Show the txid.
"Native ETH, no bridge, policy enforced privately."

**Closing (30 sec):**
"One wallet. Clear intents. Private policies. Three chains. No blind signing.
This is what every DAO treasury should look like."
