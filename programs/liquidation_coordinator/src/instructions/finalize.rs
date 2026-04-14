use anchor_lang::prelude::*;

use crate::{
    constants::MAX_BIDS,
    error::LiquidationError,
    events::AuctionResolved,
    integrations::encrypt,
    integrations::ika::{self, DWalletContext, SIGNATURE_SCHEME_SECP256K1},
    state::{AuctionStatus, BidAccount, Position},
};

#[derive(Accounts)]
pub struct Finalize<'info> {
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
    /// CHECK: Completed Encrypt decryption request for the winner index.
    pub result_request: UncheckedAccount<'info>,
    /// CHECK: Completed Encrypt decryption request for the winning bid amount.
    pub price_request: UncheckedAccount<'info>,
    /// CHECK: MessageApproval PDA on the Ika dWallet program.
    #[account(mut)]
    pub message_approval: UncheckedAccount<'info>,
    /// CHECK: dWallet account owned by the Ika program.
    pub dwallet: UncheckedAccount<'info>,
    /// CHECK: This program's executable account, passed through for CPI verification.
    pub caller_program: UncheckedAccount<'info>,
    /// CHECK: PDA derived from `__ika_cpi_authority`.
    pub cpi_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Ika dWallet program account.
    pub dwallet_program: UncheckedAccount<'info>,
}

pub fn handle_finalize(
    ctx: Context<Finalize>,
    btc_tx_hash: [u8; 32],
    approval_user_pubkey: [u8; 32],
) -> Result<()> {
    let position_key = ctx.accounts.position.key();
    let caller_program_id = ctx.accounts.caller_program.key();
    let dwallet_key = ctx.accounts.dwallet.key();
    let dwallet_program_id = ctx.accounts.dwallet_program.key();
    let (expected_cpi_authority, cpi_authority_bump) = ika::find_cpi_authority(&crate::id());
    let (expected_message_approval, message_approval_bump) =
        ika::find_message_approval_pda(&dwallet_program_id, &dwallet_key, &btc_tx_hash);
    let position = &mut ctx.accounts.position;

    require!(
        position.status == AuctionStatus::Resolving,
        LiquidationError::AuctionNotResolving
    );
    require_keys_eq!(
        caller_program_id,
        crate::id(),
        LiquidationError::InvalidCallerProgram
    );
    require_keys_eq!(
        dwallet_key,
        position.dwallet_id,
        LiquidationError::InvalidDWalletAccount
    );
    require_keys_eq!(
        ctx.accounts.cpi_authority.key(),
        expected_cpi_authority,
        LiquidationError::InvalidIkaCpiAuthority
    );
    require!(
        btc_tx_hash != [0u8; 32],
        LiquidationError::InvalidBitcoinTxHash
    );
    require_keys_eq!(
        ctx.accounts.message_approval.key(),
        expected_message_approval,
        LiquidationError::InvalidMessageApprovalAccount
    );
    require_keys_eq!(
        ctx.accounts.result_request.key(),
        position.resolution_result_request,
        LiquidationError::InvalidResolutionRequestAccount
    );
    require_keys_eq!(
        ctx.accounts.price_request.key(),
        position.resolution_price_request,
        LiquidationError::InvalidResolutionRequestAccount
    );
    require!(
        position.resolution_result_request != Pubkey::default()
            && position.resolution_price_request != Pubkey::default(),
        LiquidationError::ResolutionDecryptionNotRequested
    );
    require_keys_eq!(
        ctx.accounts.bid_0.key(),
        position.resolution_bid_0,
        LiquidationError::InvalidResolutionBidOrder
    );
    require_keys_eq!(
        ctx.accounts.bid_1.key(),
        position.resolution_bid_1,
        LiquidationError::InvalidResolutionBidOrder
    );
    require_keys_eq!(
        ctx.accounts.bid_2.key(),
        position.resolution_bid_2,
        LiquidationError::InvalidResolutionBidOrder
    );

    let winner_index = {
        let request_data = ctx.accounts.result_request.try_borrow_data()?;
        encrypt::read_decrypted_u64_verified(&request_data, &position.resolution_result_digest)
            .ok_or(error!(LiquidationError::ResolutionDecryptionNotComplete))?
    };
    require!(
        winner_index < MAX_BIDS as u64,
        LiquidationError::InvalidWinnerIndex
    );

    let clearing_price = {
        let request_data = ctx.accounts.price_request.try_borrow_data()?;
        encrypt::read_decrypted_u64_verified(&request_data, &position.resolution_price_digest)
            .ok_or(error!(LiquidationError::ResolutionDecryptionNotComplete))?
    };
    require!(clearing_price > 0, LiquidationError::InvalidClearingPrice);

    let winner_bid = match winner_index {
        0 => &ctx.accounts.bid_0,
        1 => &ctx.accounts.bid_1,
        2 => &ctx.accounts.bid_2,
        _ => unreachable!("winner index is range checked"),
    };

    let dwallet_ctx = DWalletContext {
        dwallet_program: ctx.accounts.dwallet_program.to_account_info(),
        cpi_authority: ctx.accounts.cpi_authority.to_account_info(),
        caller_program: ctx.accounts.caller_program.to_account_info(),
        cpi_authority_bump,
    };

    dwallet_ctx.approve_message(
        &ctx.accounts.message_approval.to_account_info(),
        &ctx.accounts.dwallet.to_account_info(),
        &ctx.accounts.payer.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        btc_tx_hash,
        approval_user_pubkey,
        SIGNATURE_SCHEME_SECP256K1,
        message_approval_bump,
    )?;

    position.status = AuctionStatus::Resolved;
    position.resolved_winner = winner_bid.bidder;
    position.resolved_bid = winner_bid.key();
    position.winning_ciphertext = winner_bid.ciphertext_account;
    position.clearing_price = clearing_price;
    position.approved_btc_tx_hash = btc_tx_hash;

    emit!(AuctionResolved {
        position: position_key,
        winner_pubkey: winner_bid.bidder,
        winner_btc_address: winner_bid.bidder_btc_address.clone(),
        clearing_price,
        btc_tx_hash,
    });

    Ok(())
}
