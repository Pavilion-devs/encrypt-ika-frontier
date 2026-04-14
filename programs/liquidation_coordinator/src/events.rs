use anchor_lang::prelude::*;

#[event]
pub struct AuctionOpened {
    pub position: Pubkey,
    pub deadline: i64,
    pub observed_health_factor: u64,
}

#[event]
pub struct ResolutionStarted {
    pub position: Pubkey,
    pub bid_count: u8,
}

#[event]
pub struct ResolutionDecryptionRequested {
    pub position: Pubkey,
    pub winner_request: Pubkey,
    pub price_request: Pubkey,
}

#[event]
pub struct AuctionResolved {
    pub position: Pubkey,
    pub winner_pubkey: Pubkey,
    pub winner_btc_address: String,
    pub clearing_price: u64,
    pub btc_tx_hash: [u8; 32],
}
