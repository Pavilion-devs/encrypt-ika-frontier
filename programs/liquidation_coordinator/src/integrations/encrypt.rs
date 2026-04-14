use anchor_lang::prelude::*;

pub const CPI_AUTHORITY_SEED: &[u8] = b"__encrypt_cpi_authority";
pub const EVENT_AUTHORITY_SEED: &[u8] = b"__event_authority";

const IX_EXECUTE_GRAPH: u8 = 4;
const IX_REQUEST_DECRYPTION: u8 = 11;
const CT_CIPHERTEXT_DIGEST: usize = 2;
const CT_LEN: usize = 100;
const DR_CIPHERTEXT_DIGEST: usize = 34;
const DR_TOTAL_LEN: usize = 99;
const DR_BYTES_WRITTEN: usize = 103;
const DR_HEADER_END: usize = 107;

pub struct EncryptContext<'info> {
    pub encrypt_program: AccountInfo<'info>,
    pub config: AccountInfo<'info>,
    pub deposit: AccountInfo<'info>,
    pub cpi_authority: AccountInfo<'info>,
    pub caller_program: AccountInfo<'info>,
    pub network_encryption_key: AccountInfo<'info>,
    pub payer: AccountInfo<'info>,
    pub event_authority: AccountInfo<'info>,
    pub system_program: AccountInfo<'info>,
    pub cpi_authority_bump: u8,
}

impl<'info> EncryptContext<'info> {
    pub fn execute_graph(
        &self,
        graph_data: &[u8],
        num_inputs: u8,
        remaining_accounts: &[AccountInfo<'info>],
    ) -> Result<()> {
        let mut ix_data = Vec::with_capacity(1 + 2 + graph_data.len() + 1);
        ix_data.push(IX_EXECUTE_GRAPH);
        ix_data.extend_from_slice(&(graph_data.len() as u16).to_le_bytes());
        ix_data.extend_from_slice(graph_data);
        ix_data.push(num_inputs);

        let mut accounts = vec![
            AccountMeta::new(self.config.key(), false),
            AccountMeta::new(self.deposit.key(), false),
            AccountMeta::new_readonly(self.caller_program.key(), false),
            AccountMeta::new_readonly(self.cpi_authority.key(), true),
            AccountMeta::new_readonly(self.network_encryption_key.key(), false),
            AccountMeta::new(self.payer.key(), true),
            AccountMeta::new_readonly(self.event_authority.key(), false),
            AccountMeta::new_readonly(self.encrypt_program.key(), false),
        ];
        for account in remaining_accounts {
            accounts.push(AccountMeta::new(account.key(), false));
        }

        let ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: self.encrypt_program.key(),
            accounts,
            data: ix_data,
        };

        let mut account_infos = vec![
            self.config.clone(),
            self.deposit.clone(),
            self.caller_program.clone(),
            self.cpi_authority.clone(),
            self.network_encryption_key.clone(),
            self.payer.clone(),
            self.event_authority.clone(),
            self.encrypt_program.clone(),
        ];
        account_infos.extend_from_slice(remaining_accounts);

        let seeds = &[CPI_AUTHORITY_SEED, &[self.cpi_authority_bump]];
        anchor_lang::solana_program::program::invoke_signed(&ix, &account_infos, &[seeds])?;
        Ok(())
    }

    pub fn request_decryption(
        &self,
        request_acct: &AccountInfo<'info>,
        ciphertext: &AccountInfo<'info>,
    ) -> Result<[u8; 32]> {
        let ct_data = ciphertext.try_borrow_data()?;
        let digest = parse_ciphertext_digest(&ct_data)
            .ok_or(anchor_lang::error::ErrorCode::ConstraintRaw)?;
        drop(ct_data);

        let ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: self.encrypt_program.key(),
            accounts: vec![
                AccountMeta::new_readonly(self.config.key(), false),
                AccountMeta::new(self.deposit.key(), false),
                AccountMeta::new(request_acct.key(), false),
                AccountMeta::new_readonly(self.caller_program.key(), false),
                AccountMeta::new_readonly(self.cpi_authority.key(), true),
                AccountMeta::new_readonly(ciphertext.key(), false),
                AccountMeta::new(self.payer.key(), true),
                AccountMeta::new_readonly(self.system_program.key(), false),
                AccountMeta::new_readonly(self.event_authority.key(), false),
                AccountMeta::new_readonly(self.encrypt_program.key(), false),
            ],
            data: vec![IX_REQUEST_DECRYPTION],
        };

        let account_infos = vec![
            self.config.clone(),
            self.deposit.clone(),
            request_acct.clone(),
            self.caller_program.clone(),
            self.cpi_authority.clone(),
            ciphertext.clone(),
            self.payer.clone(),
            self.system_program.clone(),
            self.event_authority.clone(),
            self.encrypt_program.clone(),
        ];

        let seeds = &[CPI_AUTHORITY_SEED, &[self.cpi_authority_bump]];
        anchor_lang::solana_program::program::invoke_signed(&ix, &account_infos, &[seeds])?;
        Ok(digest)
    }
}

pub fn find_cpi_authority(caller_program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CPI_AUTHORITY_SEED], caller_program_id)
}

pub fn find_event_authority(encrypt_program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[EVENT_AUTHORITY_SEED], encrypt_program_id)
}

pub fn parse_ciphertext_digest(data: &[u8]) -> Option<[u8; 32]> {
    if data.len() < CT_LEN {
        return None;
    }

    let mut digest = [0u8; 32];
    digest.copy_from_slice(&data[CT_CIPHERTEXT_DIGEST..CT_CIPHERTEXT_DIGEST + 32]);
    Some(digest)
}

pub fn read_decrypted_u64_verified(request_data: &[u8], expected_digest: &[u8; 32]) -> Option<u64> {
    if request_data.len() < DR_HEADER_END + 8 {
        return None;
    }

    let actual_digest =
        &request_data[DR_CIPHERTEXT_DIGEST..DR_CIPHERTEXT_DIGEST + expected_digest.len()];
    if actual_digest != expected_digest {
        return None;
    }

    let total_len = u32::from_le_bytes(
        request_data[DR_TOTAL_LEN..DR_TOTAL_LEN + 4]
            .try_into()
            .ok()?,
    );
    let bytes_written = u32::from_le_bytes(
        request_data[DR_BYTES_WRITTEN..DR_BYTES_WRITTEN + 4]
            .try_into()
            .ok()?,
    );
    if total_len != 8 || bytes_written != total_len {
        return None;
    }

    Some(u64::from_le_bytes(
        request_data[DR_HEADER_END..DR_HEADER_END + 8]
            .try_into()
            .ok()?,
    ))
}
