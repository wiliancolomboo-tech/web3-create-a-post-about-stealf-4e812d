use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("St1fXk24MGeA11vFvC6aV4h1QxZ9y8kC9tP7N3D8mN1");

pub const ANNOUNCEMENT_SEED: &[u8] = b"announcement";
pub const VAULT_SEED: &[u8] = b"vault";
pub const REGISTRY_SEED: &[u8] = b"registry";

#[program]
pub mod stealf {
    use super::*;

    /// Register a user's persistent Spending and Viewing public keys.
    pub fn register_keys(
        ctx: Context<RegisterKeys>,
        spending_pubkey: [u8; 32],
        viewing_pubkey: [u8; 32],
    ) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        registry.owner = ctx.accounts.owner.key();
        registry.spending_pubkey = spending_pubkey;
        registry.viewing_pubkey = viewing_pubkey;
        registry.bump = ctx.bumps.registry;

        emit!(KeysRegisteredEvent {
            owner: registry.owner,
            spending_pubkey,
            viewing_pubkey,
        });

        Ok(())
    }

    /// Senders transfer SOL to the stealth vault PDA and emit the ephemeral pubkey (R).
    pub fn transfer_stealth_sol(
        ctx: Context<TransferStealthSol>,
        stealth_recipient: Pubkey,
        ephemeral_pubkey: [u8; 32],
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, StealfError::InvalidZeroAmount);

        // Record announcement state
        let announcement = &mut ctx.accounts.announcement;
        announcement.stealth_address = stealth_recipient;
        announcement.ephemeral_pubkey = ephemeral_pubkey;
        announcement.sender = ctx.accounts.sender.key();
        announcement.amount = amount;
        announcement.claimed = false;
        announcement.bump = ctx.bumps.announcement;
        announcement.vault_bump = ctx.bumps.vault;

        // Move funds from sender to deterministic stealth vault PDA
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.sender.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        );
        transfer(cpi_context, amount)?;

        emit!(StealthPaymentSentEvent {
            sender: ctx.accounts.sender.key(),
            stealth_address: stealth_recipient,
            ephemeral_pubkey,
            amount,
        });

        Ok(())
    }

    /// Claim the funds accumulated in the stealth vault.
    /// The signer must be the derived stealth keypair holder or authorized authority.
    pub fn claim_stealth_sol(ctx: Context<ClaimStealthSol>) -> Result<()> {
        let announcement = &mut ctx.accounts.announcement;
        require!(!announcement.claimed, StealfError::AlreadyClaimed);

        let stealth_address = announcement.stealth_address;
        require_keys_eq!(
            ctx.accounts.stealth_signer.key(),
            stealth_address,
            StealfError::UnauthorizedClaimer
        );

        let vault_balance = ctx.accounts.vault.lamports();
        require!(vault_balance > 0, StealfError::InsufficientVaultFunds);

        // Mark as claimed to prevent re-entrancy
        announcement.claimed = true;

        let vault_bump = announcement.vault_bump;
        let seeds: &[&[u8]] = &[
            VAULT_SEED,
            stealth_address.as_ref(),
            &[vault_bump],
        ];
        let signer_seeds = &[seeds];

        // Drain vault lamports to destination
        let cpi_context = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
            },
            signer_seeds,
        );
        transfer(cpi_context, vault_balance)?;

        // Close announcement account to reclaim rent back to destination
        let destination_info = ctx.accounts.destination.to_account_info();
        let announcement_info = ctx.accounts.announcement.to_account_info();

        let rent_lamports = announcement_info.lamports();
        **announcement_info.lamports.borrow_mut() = 0;
        **destination_info.lamports.borrow_mut() = destination_info
            .lamports()
            .checked_add(rent_lamports)
            .ok_or(StealfError::NumericalOverflow)?;

        emit!(StealthClaimedEvent {
            stealth_address,
            destination: ctx.accounts.destination.key(),
            amount: vault_balance,
        });

        Ok(())
    }
}

// -----------------------------------------------------------------------------
// Account Contexts
// -----------------------------------------------------------------------------

#[derive(Accounts)]
pub struct RegisterKeys<'info> {
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + UserRegistry::INIT_SPACE,
        seeds = [REGISTRY_SEED, owner.key().as_ref()],
        bump
    )]
    pub registry: Account<'info, UserRegistry>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(stealth_recipient: Pubkey)]
pub struct TransferStealthSol<'info> {
    #[account(
        init,
        payer = sender,
        space = 8 + Announcement::INIT_SPACE,
        seeds = [ANNOUNCEMENT_SEED, stealth_recipient.as_ref()],
        bump
    )]
    pub announcement: Account<'info, Announcement>,

    /// CHECK: Vault PDA derived deterministically via seeds [b"vault", stealth_recipient.as_ref()]
    #[account(
        mut,
        seeds = [VAULT_SEED, stealth_recipient.as_ref()],
        bump
    )]
    pub vault: SystemAccount<'info>,

    #[account(mut)]
    pub sender: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimStealthSol<'info> {
    #[account(
        mut,
        seeds = [ANNOUNCEMENT_SEED, stealth_signer.key().as_ref()],
        bump = announcement.bump,
        has_one = stealth_address @ StealfError::InvalidStealthAddress
    )]
    pub announcement: Account<'info, Announcement>,

    /// CHECK: PDA holding the locked funds.
    #[account(
        mut,
        seeds = [VAULT_SEED, stealth_signer.key().as_ref()],
        bump = announcement.vault_bump
    )]
    pub vault: SystemAccount<'info>,

    /// Signer must be the derived stealth keypair
    pub stealth_signer: Signer<'info>,

    /// Target address receiving the balance and recovered rent
    #[account(mut)]
    pub destination: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

// -----------------------------------------------------------------------------
// State Structs
// -----------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct UserRegistry {
    pub owner: Pubkey,
    pub spending_pubkey: [u8; 32],
    pub viewing_pubkey: [u8; 32],
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Announcement {
    pub stealth_address: Pubkey,
    pub ephemeral_pubkey: [u8; 32],
    pub sender: Pubkey,
    pub amount: u64,
    pub claimed: bool,
    pub bump: u8,
    pub vault_bump: u8,
}

// -----------------------------------------------------------------------------
// Events & Errors
// -----------------------------------------------------------------------------

#[event]
pub struct KeysRegisteredEvent {
    pub owner: Pubkey,
    pub spending_pubkey: [u8; 32],
    pub viewing_pubkey: [u8; 32],
}

#[event]
pub struct StealthPaymentSentEvent {
    pub sender: Pubkey,
    pub stealth_address: Pubkey,
    pub ephemeral_pubkey: [u8; 32],
    pub amount: u64,
}

#[event]
pub struct StealthClaimedEvent {
    pub stealth_address: Pubkey,
    pub destination: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum StealfError {
    #[msg("Transfer amount must be greater than zero.")]
    InvalidZeroAmount,
    #[msg("The stealth funds have already been claimed.")]
    AlreadyClaimed,
    #[msg("Signer does not match the stealth target address.")]
    UnauthorizedClaimer,
    #[msg("No lamports available in stealth vault.")]
    InsufficientVaultFunds,
    #[msg("Stealth address mismatch.")]
    InvalidStealthAddress,
    #[msg("Arithmetic overflow occurred during balance calculation.")]
    NumericalOverflow,
}