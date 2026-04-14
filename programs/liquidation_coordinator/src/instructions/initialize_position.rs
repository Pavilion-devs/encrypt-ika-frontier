use anchor_lang::prelude::*;

use crate::{
    constants::{DEMO_COLLATERAL_SATS, POSITION_SEED},
    error::LiquidationError,
    state::{AuctionStatus, Position},
};

#[derive(Accounts)]
#[instruction(dwallet_id: Pubkey)]
pub struct InitializePosition<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, borrower.key().as_ref(), dwallet_id.as_ref()],
        bump,
    )]
    pub position: Account<'info, Position>,
    pub borrower: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_position(
    ctx: Context<InitializePosition>,
    dwallet_id: Pubkey,
    dwallet_btc_address: String,
    debt_amount: u64,
    health_threshold: u64,
) -> Result<()> {
    require!(debt_amount > 0, LiquidationError::InvalidDebtAmount);
    require!(
        health_threshold > 0,
        LiquidationError::InvalidHealthThreshold
    );
    require!(
        !dwallet_btc_address.trim().is_empty(),
        LiquidationError::InvalidBitcoinAddress
    );
    require!(
        dwallet_btc_address.len() <= 90,
        LiquidationError::InvalidBitcoinAddress
    );

    let position = &mut ctx.accounts.position;
    position.borrower = ctx.accounts.borrower.key();
    position.debt_amount = debt_amount;
    position.collateral_btc = DEMO_COLLATERAL_SATS;
    position.dwallet_id = dwallet_id;
    position.dwallet_btc_address = dwallet_btc_address;
    position.health_threshold = health_threshold;
    position.last_health_factor = health_threshold;
    position.status = AuctionStatus::Active;
    position.auction_deadline = 0;
    position.bid_count = 0;
    position.resolved_winner = Pubkey::default();
    position.resolved_bid = Pubkey::default();
    position.resolution_result_ciphertext = Pubkey::default();
    position.resolution_price_ciphertext = Pubkey::default();
    position.resolution_bid_0 = Pubkey::default();
    position.resolution_bid_1 = Pubkey::default();
    position.resolution_bid_2 = Pubkey::default();
    position.resolution_result_request = Pubkey::default();
    position.resolution_price_request = Pubkey::default();
    position.resolution_result_digest = [0u8; 32];
    position.resolution_price_digest = [0u8; 32];
    position.winning_ciphertext = Pubkey::default();
    position.clearing_price = 0;
    position.approved_btc_tx_hash = [0u8; 32];
    position.resolve_graph = Vec::new();
    position.bump = ctx.bumps.position;

    Ok(())
}
