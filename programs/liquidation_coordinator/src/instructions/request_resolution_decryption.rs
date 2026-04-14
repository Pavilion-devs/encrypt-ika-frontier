use anchor_lang::prelude::*;

use crate::{
    error::LiquidationError,
    events::ResolutionDecryptionRequested,
    integrations::encrypt::{self, EncryptContext},
    state::{AuctionStatus, Position},
};

#[derive(Accounts)]
pub struct RequestResolutionDecryption<'info> {
    #[account(mut)]
    pub position: Account<'info, Position>,
    /// CHECK: New Encrypt decryption request account for the winner index.
    #[account(mut)]
    pub result_request: Signer<'info>,
    /// CHECK: New Encrypt decryption request account for the winning bid amount.
    #[account(mut)]
    pub price_request: Signer<'info>,
    /// CHECK: Existing Encrypt ciphertext account holding the winner index.
    pub result_ciphertext: UncheckedAccount<'info>,
    /// CHECK: Existing Encrypt ciphertext account holding the winning bid amount.
    pub price_ciphertext: UncheckedAccount<'info>,
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

pub fn handle_request_resolution_decryption(
    ctx: Context<RequestResolutionDecryption>,
) -> Result<()> {
    let position_key = ctx.accounts.position.key();
    let encrypt_program_id = ctx.accounts.encrypt_program.key();
    let caller_program_id = ctx.accounts.caller_program.key();
    let (expected_cpi_authority, cpi_authority_bump) = encrypt::find_cpi_authority(&crate::id());
    let (expected_event_authority, _) = encrypt::find_event_authority(&encrypt_program_id);
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
        ctx.accounts.result_ciphertext.key(),
        position.resolution_result_ciphertext,
        LiquidationError::InvalidResolutionCiphertextAccount
    );
    require_keys_eq!(
        ctx.accounts.price_ciphertext.key(),
        position.resolution_price_ciphertext,
        LiquidationError::InvalidResolutionCiphertextAccount
    );
    require!(
        position.resolution_result_request == Pubkey::default()
            && position.resolution_price_request == Pubkey::default(),
        LiquidationError::ResolutionDecryptionAlreadyRequested
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

    let result_digest = encrypt_ctx.request_decryption(
        &ctx.accounts.result_request.to_account_info(),
        &ctx.accounts.result_ciphertext.to_account_info(),
    )?;
    let price_digest = encrypt_ctx.request_decryption(
        &ctx.accounts.price_request.to_account_info(),
        &ctx.accounts.price_ciphertext.to_account_info(),
    )?;

    position.resolution_result_request = ctx.accounts.result_request.key();
    position.resolution_price_request = ctx.accounts.price_request.key();
    position.resolution_result_digest = result_digest;
    position.resolution_price_digest = price_digest;

    emit!(ResolutionDecryptionRequested {
        position: position_key,
        winner_request: ctx.accounts.result_request.key(),
        price_request: ctx.accounts.price_request.key(),
    });

    Ok(())
}
