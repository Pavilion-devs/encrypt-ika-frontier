use anchor_lang::prelude::*;

#[error_code]
pub enum LiquidationError {
    #[msg("Debt amount must be greater than zero")]
    InvalidDebtAmount,
    #[msg("Health threshold must be greater than zero")]
    InvalidHealthThreshold,
    #[msg("Bitcoin address is invalid for the demo")]
    InvalidBitcoinAddress,
    #[msg("Position is still healthy")]
    PositionHealthy,
    #[msg("Position is not in the Active state")]
    PositionNotActive,
    #[msg("Auction is not open")]
    AuctionNotOpen,
    #[msg("Auction is not in the Resolving state")]
    AuctionNotResolving,
    #[msg("Auction deadline has not passed yet")]
    AuctionDeadlineNotReached,
    #[msg("Bid submission window is closed")]
    BidWindowClosed,
    #[msg("Maximum number of demo bids already submitted")]
    MaxBidsReached,
    #[msg("The auction does not have the required demo bid count")]
    WrongBidCount,
    #[msg("Winner bid does not belong to this position")]
    InvalidWinnerBid,
    #[msg("The provided caller program account does not match this program")]
    InvalidCallerProgram,
    #[msg("The provided dWallet account does not match the position")]
    InvalidDWalletAccount,
    #[msg("The Ika CPI authority PDA is invalid")]
    InvalidIkaCpiAuthority,
    #[msg("The Encrypt CPI authority PDA is invalid")]
    InvalidEncryptCpiAuthority,
    #[msg("The Encrypt event authority PDA is invalid")]
    InvalidEncryptEventAuthority,
    #[msg("Encrypt graph data cannot be empty")]
    EmptyEncryptGraph,
    #[msg("Resolve auction graph does not match the canonical liquidation graph")]
    UnexpectedResolveGraph,
    #[msg("The provided bid ciphertext account does not match the stored bid state")]
    InvalidBidCiphertextAccount,
    #[msg("Resolve auction requires three distinct bid accounts in a fixed order")]
    InvalidResolutionBidOrder,
    #[msg("Resolve auction is missing Encrypt output accounts")]
    MissingEncryptOutputCiphertext,
    #[msg("Resolution decryption has already been requested")]
    ResolutionDecryptionAlreadyRequested,
    #[msg("Resolution decryption has not been requested yet")]
    ResolutionDecryptionNotRequested,
    #[msg("The provided resolution decryption request account is invalid")]
    InvalidResolutionRequestAccount,
    #[msg("The provided resolution ciphertext account is invalid")]
    InvalidResolutionCiphertextAccount,
    #[msg("Resolution decryption is not complete yet")]
    ResolutionDecryptionNotComplete,
    #[msg("Decrypted winner index is out of range")]
    InvalidWinnerIndex,
    #[msg("The MessageApproval PDA does not match the expected derivation")]
    InvalidMessageApprovalAccount,
    #[msg("Bitcoin transaction hash cannot be empty")]
    InvalidBitcoinTxHash,
    #[msg("Clearing price must be greater than zero")]
    InvalidClearingPrice,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
}
