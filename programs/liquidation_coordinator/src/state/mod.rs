use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub borrower: Pubkey,
    pub debt_amount: u64,
    pub collateral_btc: u64,
    pub dwallet_id: Pubkey,
    #[max_len(90)]
    pub dwallet_btc_address: String,
    pub health_threshold: u64,
    pub last_health_factor: u64,
    pub status: AuctionStatus,
    pub auction_deadline: i64,
    pub bid_count: u8,
    pub resolved_winner: Pubkey,
    pub resolved_bid: Pubkey,
    pub resolution_result_ciphertext: Pubkey,
    pub resolution_price_ciphertext: Pubkey,
    pub resolution_bid_0: Pubkey,
    pub resolution_bid_1: Pubkey,
    pub resolution_bid_2: Pubkey,
    pub resolution_result_request: Pubkey,
    pub resolution_price_request: Pubkey,
    pub resolution_result_digest: [u8; 32],
    pub resolution_price_digest: [u8; 32],
    pub winning_ciphertext: Pubkey,
    pub clearing_price: u64,
    pub approved_btc_tx_hash: [u8; 32],
    #[max_len(512)]
    pub resolve_graph: Vec<u8>,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct BidAccount {
    pub position: Pubkey,
    pub bidder: Pubkey,
    #[max_len(90)]
    pub bidder_btc_address: String,
    pub ciphertext_account: Pubkey,
    pub submitted_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum AuctionStatus {
    Active,
    AuctionOpen,
    Resolving,
    Resolved,
}
