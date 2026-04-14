use anchor_lang::prelude::*;
use liquidation_graph::build_resolve_auction_graph;

use crate::{
    constants::MAX_BIDS,
    error::LiquidationError,
    events::ResolutionStarted,
    integrations::encrypt::{self, EncryptContext},
    state::{AuctionStatus, BidAccount, Position},
};

#[derive(Accounts)]
pub struct ResolveAuction<'info> {
    #[account(mut)]
    pub position: Account<'info, Position>,
    #[account(
        constraint = bid_0.position == position.key() @ LiquidationError::InvalidWinnerBid,
    )]
    pub bid_0: Account<'info, BidAccount>,
    #[account(
        constraint = bid_1.position == position.key() @ LiquidationError::InvalidWinnerBid,
    )]
    pub bid_1: Account<'info, BidAccount>,
    #[account(
        constraint = bid_2.position == position.key() @ LiquidationError::InvalidWinnerBid,
    )]
    pub bid_2: Account<'info, BidAccount>,
    /// CHECK: Encrypt ciphertext account for `bid_0`.
    #[account(mut)]
    pub bid_0_ciphertext: UncheckedAccount<'info>,
    /// CHECK: Encrypt ciphertext account for `bid_1`.
    #[account(mut)]
    pub bid_1_ciphertext: UncheckedAccount<'info>,
    /// CHECK: Encrypt ciphertext account for `bid_2`.
    #[account(mut)]
    pub bid_2_ciphertext: UncheckedAccount<'info>,
    /// CHECK: New Encrypt ciphertext account that will hold the winner index.
    #[account(mut)]
    pub result_ciphertext: Signer<'info>,
    /// CHECK: New Encrypt ciphertext account that will hold the winning bid amount.
    #[account(mut)]
    pub price_ciphertext: Signer<'info>,
    /// CHECK: Encrypt program account.
    pub encrypt_program: UncheckedAccount<'info>,
    /// CHECK: Encrypt config PDA.
    pub config: UncheckedAccount<'info>,
    /// CHECK: Encrypt deposit account.
    #[account(mut)]
    pub deposit: UncheckedAccount<'info>,
    /// CHECK: PDA derived from `__encrypt_cpi_authority`.
    pub cpi_authority: UncheckedAccount<'info>,
    /// CHECK: This program's executable account, passed through for CPI verification.
    pub caller_program: UncheckedAccount<'info>,
    /// CHECK: Encrypt network encryption key PDA.
    pub network_encryption_key: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Encrypt event authority PDA.
    pub event_authority: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_resolve_auction<'info>(
    ctx: Context<'_, '_, '_, 'info, ResolveAuction<'info>>,
    graph_data: Vec<u8>,
) -> Result<()> {
    let position_key = ctx.accounts.position.key();
    let encrypt_program_id = ctx.accounts.encrypt_program.key();
    let caller_program_id = ctx.accounts.caller_program.key();
    let (expected_cpi_authority, cpi_authority_bump) = encrypt::find_cpi_authority(&crate::id());
    let (expected_event_authority, _) = encrypt::find_event_authority(&encrypt_program_id);
    let position = &mut ctx.accounts.position;

    require!(
        position.status == AuctionStatus::AuctionOpen,
        LiquidationError::AuctionNotOpen
    );
    require!(
        position.bid_count == MAX_BIDS,
        LiquidationError::WrongBidCount
    );

    let now = Clock::get()?.unix_timestamp;
    require!(
        now > position.auction_deadline,
        LiquidationError::AuctionDeadlineNotReached
    );
    require_keys_eq!(
        caller_program_id,
        crate::id(),
        LiquidationError::InvalidCallerProgram
    );
    require_keys_eq!(
        ctx.accounts.cpi_authority.key(),
        expected_cpi_authority,
        LiquidationError::InvalidEncryptCpiAuthority
    );
    require_keys_eq!(
        ctx.accounts.event_authority.key(),
        expected_event_authority,
        LiquidationError::InvalidEncryptEventAuthority
    );
    require_keys_eq!(
        ctx.accounts.bid_0.ciphertext_account,
        ctx.accounts.bid_0_ciphertext.key(),
        LiquidationError::InvalidBidCiphertextAccount
    );
    require_keys_eq!(
        ctx.accounts.bid_1.ciphertext_account,
        ctx.accounts.bid_1_ciphertext.key(),
        LiquidationError::InvalidBidCiphertextAccount
    );
    require_keys_eq!(
        ctx.accounts.bid_2.ciphertext_account,
        ctx.accounts.bid_2_ciphertext.key(),
        LiquidationError::InvalidBidCiphertextAccount
    );
    require!(
        ctx.accounts.bid_0.key() != ctx.accounts.bid_1.key()
            && ctx.accounts.bid_0.key() != ctx.accounts.bid_2.key()
            && ctx.accounts.bid_1.key() != ctx.accounts.bid_2.key(),
        LiquidationError::InvalidResolutionBidOrder
    );

    let canonical_graph = build_resolve_auction_graph();
    let resolved_graph = if graph_data.is_empty() {
        canonical_graph.clone()
    } else {
        graph_data
    };
    require!(
        resolved_graph == canonical_graph,
        LiquidationError::UnexpectedResolveGraph
    );

    let encrypt_ctx = EncryptContext {
        encrypt_program: ctx.accounts.encrypt_program.to_account_info(),
        config: ctx.accounts.config.to_account_info(),
        deposit: ctx.accounts.deposit.to_account_info(),
        cpi_authority: ctx.accounts.cpi_authority.to_account_info(),
        caller_program: ctx.accounts.caller_program.to_account_info(),
        network_encryption_key: ctx.accounts.network_encryption_key.to_account_info(),
        payer: ctx.accounts.payer.to_account_info(),
        event_authority: ctx.accounts.event_authority.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
        cpi_authority_bump,
    };

    let execute_accounts = [
        ctx.accounts.bid_0_ciphertext.to_account_info(),
        ctx.accounts.bid_1_ciphertext.to_account_info(),
        ctx.accounts.bid_2_ciphertext.to_account_info(),
        ctx.accounts.result_ciphertext.to_account_info(),
        ctx.accounts.price_ciphertext.to_account_info(),
    ];
    encrypt_ctx.execute_graph(&resolved_graph, MAX_BIDS, &execute_accounts)?;

    position.status = AuctionStatus::Resolving;
    position.resolution_result_ciphertext = ctx.accounts.result_ciphertext.key();
    position.resolution_price_ciphertext = ctx.accounts.price_ciphertext.key();
    position.resolution_bid_0 = ctx.accounts.bid_0.key();
    position.resolution_bid_1 = ctx.accounts.bid_1.key();
    position.resolution_bid_2 = ctx.accounts.bid_2.key();
    position.resolution_result_request = Pubkey::default();
    position.resolution_price_request = Pubkey::default();
    position.resolution_result_digest = [0u8; 32];
    position.resolution_price_digest = [0u8; 32];
    position.resolve_graph = resolved_graph;

    emit!(ResolutionStarted {
        position: position_key,
        bid_count: position.bid_count,
    });

    Ok(())
}
