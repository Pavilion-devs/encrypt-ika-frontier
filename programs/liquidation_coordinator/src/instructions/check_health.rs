use anchor_lang::prelude::*;

use crate::{
    constants::AUCTION_WINDOW_SECONDS,
    error::LiquidationError,
    events::AuctionOpened,
    state::{AuctionStatus, Position},
};

#[derive(Accounts)]
pub struct CheckHealth<'info> {
    #[account(mut)]
    pub position: Account<'info, Position>,
    pub caller: Signer<'info>,
}

pub fn handle_check_health(ctx: Context<CheckHealth>, observed_health_factor: u64) -> Result<()> {
    let position_key = ctx.accounts.position.key();
    let position = &mut ctx.accounts.position;

    require!(
        position.status == AuctionStatus::Active,
        LiquidationError::PositionNotActive
    );
    require!(
        observed_health_factor < position.health_threshold,
        LiquidationError::PositionHealthy
    );

    let clock = Clock::get()?;
    let deadline = clock
        .unix_timestamp
        .checked_add(AUCTION_WINDOW_SECONDS)
        .ok_or(error!(LiquidationError::ArithmeticOverflow))?;

    position.last_health_factor = observed_health_factor;
    position.status = AuctionStatus::AuctionOpen;
    position.auction_deadline = deadline;

    emit!(AuctionOpened {
        position: position_key,
        deadline,
        observed_health_factor,
    });

    Ok(())
}
