use anchor_lang::prelude::*;

use crate::{
    constants::{BID_SEED, MAX_BIDS},
    error::LiquidationError,
    state::{AuctionStatus, BidAccount, Position},
};

#[derive(Accounts)]
pub struct SubmitBid<'info> {
    #[account(mut)]
    pub position: Account<'info, Position>,
    #[account(
        init,
        payer = payer,
        space = 8 + BidAccount::INIT_SPACE,
        seeds = [BID_SEED, position.key().as_ref(), bidder.key().as_ref()],
        bump,
    )]
    pub bid: Account<'info, BidAccount>,
    pub bidder: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_submit_bid(
    ctx: Context<SubmitBid>,
    ciphertext_account: Pubkey,
    bidder_btc_address: String,
) -> Result<()> {
    let position = &mut ctx.accounts.position;

    require!(
        position.status == AuctionStatus::AuctionOpen,
        LiquidationError::AuctionNotOpen
    );
    require!(
        bidder_btc_address.len() <= 90 && !bidder_btc_address.trim().is_empty(),
        LiquidationError::InvalidBitcoinAddress
    );
    require!(
        position.bid_count < MAX_BIDS,
        LiquidationError::MaxBidsReached
    );

    let now = Clock::get()?.unix_timestamp;
    require!(
        position.auction_deadline > 0 && now <= position.auction_deadline,
        LiquidationError::BidWindowClosed
    );

    let bid = &mut ctx.accounts.bid;
    bid.position = position.key();
    bid.bidder = ctx.accounts.bidder.key();
    bid.bidder_btc_address = bidder_btc_address;
    bid.ciphertext_account = ciphertext_account;
    bid.submitted_at = now;
    bid.bump = ctx.bumps.bid;

    position.bid_count = position
        .bid_count
        .checked_add(1)
        .ok_or(error!(LiquidationError::ArithmeticOverflow))?;

    Ok(())
}
