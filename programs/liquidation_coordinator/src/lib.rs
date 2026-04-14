pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod integrations;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("9tzQ4FnSYVuqFA3EeYzKVPAZBtGq266TvuFR6H22rm59");

#[program]
pub mod liquidation_coordinator {
    use super::*;

    pub fn initialize_position(
        ctx: Context<InitializePosition>,
        dwallet_id: Pubkey,
        dwallet_btc_address: String,
        debt_amount: u64,
        health_threshold: u64,
    ) -> Result<()> {
        initialize_position::handle_initialize_position(
            ctx,
            dwallet_id,
            dwallet_btc_address,
            debt_amount,
            health_threshold,
        )
    }

    pub fn check_health(ctx: Context<CheckHealth>, observed_health_factor: u64) -> Result<()> {
        check_health::handle_check_health(ctx, observed_health_factor)
    }

    pub fn submit_bid(
        ctx: Context<SubmitBid>,
        ciphertext_account: Pubkey,
        bidder_btc_address: String,
    ) -> Result<()> {
        submit_bid::handle_submit_bid(ctx, ciphertext_account, bidder_btc_address)
    }

    pub fn resolve_auction<'info>(
        ctx: Context<'_, '_, '_, 'info, ResolveAuction<'info>>,
        graph_data: Vec<u8>,
    ) -> Result<()> {
        resolve_auction::handle_resolve_auction(ctx, graph_data)
    }

    pub fn request_resolution_decryption(ctx: Context<RequestResolutionDecryption>) -> Result<()> {
        request_resolution_decryption::handle_request_resolution_decryption(ctx)
    }

    pub fn finalize(
        ctx: Context<Finalize>,
        btc_tx_hash: [u8; 32],
        approval_user_pubkey: [u8; 32],
    ) -> Result<()> {
        finalize::handle_finalize(ctx, btc_tx_hash, approval_user_pubkey)
    }
}
