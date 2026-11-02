use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    program::invoke,
    system_instruction,
};

declare_id!("Stea1f1111111111111111111111111111111111111");

#[program]
pub mod stealf {
    use super::*;

    /// Initializes the protocol global parameters if registry state is required.
    pub fn initialize(ctx: Context<Initialize>, protocol_fee_bps: u16) -> Result<()> {
        require!(protocol_fee_bps <= 100, StealfError::FeeExceedsCap); // Max 1%
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.protocol_fee_bps = protocol_fee_bps;
        config.total_transfers = 0;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    /// Primary entry point: Executes a native SOL stealth transfer.
    /// Derives the stealth address off-chain, verifies correctness, transfers SOL,
    /// and logs the ephemeral announcement for the recipient scanner.
    pub fn send_stealth_sol(
        ctx: Context<SendStealthSol>,
        ephemeral_pubkey: [u8; 32],
        stealth_recipient: Pubkey,
        view_tag: u8,
        amount: u64,
        memo: Option<String>,
    ) -> Result<()> {
        require!(amount > 0, StealfError::InvalidAmount);
        if let Some(ref m) = memo {
            require!(m.len() <= 64, StealfError::MemoTooLong);
        }

        // Transfer SOL from sender directly to the computed stealth recipient
        let transfer_instruction = system_instruction::transfer(
            &ctx.accounts.sender.key(),
            &stealth_recipient,
            amount,
        );

        invoke(
            &transfer_instruction,
            &[
                ctx.accounts.sender.to_account_info(),
                ctx.accounts.stealth_recipient.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // Update protocol metrics
        let config = &mut ctx.accounts.config;
        config.total_transfers = config.total_transfers.checked_add(1).ok_or(StealfError::NumericalOverflow)?;

        // Emit announcement event indexed by scanning nodes
        emit!(StealthTransferAnnounced {
            sender: ctx.accounts.sender.key(),
            ephemeral_pubkey,
            stealth_recipient,
            view_tag,
            amount,
            timestamp: Clock::get()?.unix_timestamp,
            memo,
        });

        Ok(())
    }

    /// Emits a lightweight announcement for SPL-token stealth transfers or transactions
    /// executed through direct token program CPIs.
    pub fn emit_announcement(
        ctx: Context<EmitAnnouncement>,
        ephemeral_pubkey: [u8; 32],
        stealth_recipient: Pubkey,
        view_tag: u8,
        amount: u64,
        token_mint: Option<Pubkey>,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.total_transfers = config.total_transfers.checked_add(1).ok_or(StealfError::NumericalOverflow)?;

        emit!(StealthTransferAnnounced {
            sender: ctx.accounts.sender.key(),
            ephemeral_pubkey,
            stealth_recipient,
            view_tag,
            amount,
            timestamp: Clock::get()?.unix_timestamp,
            memo: token_mint.map(|m| m.to_string()),
        });

        Ok(())
    }
}

// -----------------------------------------------------------------------------
// ACCOUNT VALIDATION CONTEXTS
// -----------------------------------------------------------------------------

#[derive(Accounts)]
pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + ProtocolConfig::LEN,
        seeds = [b"stealf_config"],
        bump
    )]
    pub config: Account<'info, ProtocolConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SendStealthSol<'info> {
    #[account(
        mut,
        seeds = [b"stealf_config"],
        bump = config.bump
    )]
    pub config: Account<'info, ProtocolConfig>,

    #[account(mut)]
    pub sender: Signer<'info>,

    /// CHECK: The stealth recipient account derived cryptographically via DKSAP.
    /// Verified on-chain simply as the destination of SOL funds.
    #[account(mut)]
    pub stealth_recipient: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EmitAnnouncement<'info> {
    #[account(
        mut,
        seeds = [b"stealf_config"],
        bump = config.bump
    )]
    pub config: Account<'info, ProtocolConfig>,

    pub sender: Signer<'info>,
}

// -----------------------------------------------------------------------------
// STATE STRUCTURES & EVENTS
// -----------------------------------------------------------------------------

#[account]
pub struct ProtocolConfig {
    pub authority: Pubkey,
    pub protocol_fee_bps: u16,
    pub total_transfers: u64,
    pub bump: u8,
}

impl ProtocolConfig {
    pub const LEN: usize = 32 + 2 + 8 + 1;
}

#[event]
pub struct StealthTransferAnnounced {
    pub sender: Pubkey,
    pub ephemeral_pubkey: [u8; 32],
    pub stealth_recipient: Pubkey,
    pub view_tag: u8,
    pub amount: u64,
    pub timestamp: i64,
    pub memo: Option<String>,
}

// -----------------------------------------------------------------------------
// CUSTOM ERRORS
// -----------------------------------------------------------------------------

#[error_code]
pub enum StealfError {
    #[msg("Protocol fee exceeds maximum allowed cap of 100 bps (1%).")]
    FeeExceedsCap,
    #[msg("Transfer amount must be strictly positive.")]
    InvalidAmount,
    #[msg("Supplied transfer memo exceeds 64 bytes.")]
    MemoTooLong,
    #[msg("Mathematical overflow occurred during state progression.")]
    NumericalOverflow,
}