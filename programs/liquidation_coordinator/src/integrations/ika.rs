use anchor_lang::prelude::*;

pub const CPI_AUTHORITY_SEED: &[u8] = b"__ika_cpi_authority";
pub const MESSAGE_APPROVAL_SEED: &[u8] = b"message_approval";

const IX_APPROVE_MESSAGE: u8 = 8;
pub const SIGNATURE_SCHEME_SECP256K1: u8 = 1;

pub struct DWalletContext<'info> {
    pub dwallet_program: AccountInfo<'info>,
    pub cpi_authority: AccountInfo<'info>,
    pub caller_program: AccountInfo<'info>,
    pub cpi_authority_bump: u8,
}

impl<'info> DWalletContext<'info> {
    pub fn approve_message(
        &self,
        message_approval: &AccountInfo<'info>,
        dwallet: &AccountInfo<'info>,
        payer: &AccountInfo<'info>,
        system_program: &AccountInfo<'info>,
        message_hash: [u8; 32],
        user_pubkey: [u8; 32],
        signature_scheme: u8,
        bump: u8,
    ) -> Result<()> {
        let mut ix_data = Vec::with_capacity(67);
        ix_data.push(IX_APPROVE_MESSAGE);
        ix_data.push(bump);
        ix_data.extend_from_slice(&message_hash);
        ix_data.extend_from_slice(&user_pubkey);
        ix_data.push(signature_scheme);

        let accounts = vec![
            AccountMeta::new(message_approval.key(), false),
            AccountMeta::new_readonly(dwallet.key(), false),
            AccountMeta::new_readonly(self.caller_program.key(), false),
            AccountMeta::new_readonly(self.cpi_authority.key(), true),
            AccountMeta::new(payer.key(), true),
            AccountMeta::new_readonly(system_program.key(), false),
        ];

        let ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: self.dwallet_program.key(),
            accounts,
            data: ix_data,
        };

        let account_infos = vec![
            message_approval.clone(),
            dwallet.clone(),
            self.caller_program.clone(),
            self.cpi_authority.clone(),
            payer.clone(),
            system_program.clone(),
            self.dwallet_program.clone(),
        ];

        let seeds = &[CPI_AUTHORITY_SEED, &[self.cpi_authority_bump]];
        anchor_lang::solana_program::program::invoke_signed(&ix, &account_infos, &[seeds])?;
        Ok(())
    }
}

pub fn find_cpi_authority(caller_program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CPI_AUTHORITY_SEED], caller_program_id)
}

pub fn find_message_approval_pda(
    dwallet_program_id: &Pubkey,
    dwallet: &Pubkey,
    message_hash: &[u8; 32],
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            MESSAGE_APPROVAL_SEED,
            dwallet.as_ref(),
            message_hash.as_ref(),
        ],
        dwallet_program_id,
    )
}
