use anchor_lang::prelude::*;

#[constant]
pub const POSITION_SEED: &[u8] = b"position";
#[constant]
pub const BID_SEED: &[u8] = b"bid";
#[constant]
pub const AUCTION_WINDOW_SECONDS: i64 = 60;
#[constant]
pub const MAX_BIDS: u8 = 3;
#[constant]
pub const DEMO_COLLATERAL_SATS: u64 = 50_000_000;

pub const IKA_SOLANA_PRE_ALPHA_PROGRAM_ID: &str = "87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY";
pub const ENCRYPT_SOLANA_PRE_ALPHA_PROGRAM_ID: &str =
    "4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8";
