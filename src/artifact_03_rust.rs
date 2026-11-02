use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    program::invoke,
    system_instruction,
};

declare_id!("StEALF1111111111111111111111111111111111111");

pub const PREFIX_REGISTRY: &[u8] = b"stealf_registry";
pub const PREFIX_PAYMENT: &[u8] = b"stealf_payment";

#[program]
pub mod stealf_protocol {
    use super::*;

    /// Registers a stealth meta-address for an entity.
    /// Publishes public spend key and public view key on-chain.
    pub fn register_meta_address(
        ctx: Context<RegisterMetaAddress>,
        spend_pubkey: [u8; 32],
        view_pubkey: [u8; 32],
        metadata_uri: String,
    ) -> Result<()> {
        require!(metadata_uri.len() <= 128, StealfError::MetadataTooLong);
        
        let registry = &mut ctx.accounts.registry;
        registry.owner = ctx.accounts.owner.key();
        registry.spend_pubkey = spend_pubkey;
        registry.view_pubkey = view_pubkey;
        registry.metadata_uri = metadata_uri;
        registry.bump = ctx.bumps.registry;
        registry.registered_at = Clock::get()?.unix_timestamp;

        emit!(MetaAddressRegisteredEvent {
            owner: registry.owner,
            spend_pubkey,
            view_pubkey,
            timestamp: registry.registered_at,
        });

        Ok(())
    }

    /// Executes an unlinkable stealth transfer.
    /// Transfers native SOL to the derived stealth address while emitting an
    /// ephemeral key publication event for off-chain detection.
    pub fn send_stealth_sol(
        ctx: Context<SendStealthSol>,
        ephemeral_pubkey: [u8; 32],
        amount: u64,
        memo: [u8; 32],
    ) -> Result<()> {
        require!(amount > 0, StealfError::InvalidAmount);

        // Execute native SOL transfer to the derived stealth recipient
        let transfer_instruction = system_instruction::transfer(
            &ctx.accounts.payer.key(),
            &ctx.accounts.stealth_recipient.key(),
            amount,
        );

        invoke(
            &transfer_instruction,
            &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.stealth_recipient.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // Emit announcement event enabling the recipient's viewing key daemon to index
        emit!(StealthPaymentSentEvent {
            payer: ctx.accounts.payer.key(),
            stealth_recipient: ctx.accounts.stealth_recipient.key(),
            ephemeral_pubkey,
            amount,
            memo,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Update viewing or spending parameters if needed.
    pub fn update_meta_address(
        ctx: Context<UpdateMetaAddress>,
        new_view_pubkey: [u8; 32],
        new_metadata_uri: String,
    ) -> Result<()> {
        require!(new_metadata_uri.len() <= 128, StealfError::MetadataTooLong);
        
        let registry = &mut ctx.accounts.registry;
        registry.view_pubkey = new_view_pubkey;
        registry.metadata_uri = new_metadata_uri;

        emit!(MetaAddressUpdatedEvent {
            owner: registry.owner,
            view_pubkey: new_view_pubkey,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }
}

// ----------------------------------------------------------------------------
// Account Structs
// ----------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(spend_pubkey: [u8; 32], view_pubkey: [u8; 32])]
pub struct RegisterMetaAddress<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + StealthRegistry::INIT_SPACE,
        seeds = [PREFIX_REGISTRY, owner.key().as_ref()],
        bump
    )]
    pub registry: Account<'info, StealthRegistry>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SendStealthSol<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: The stealth recipient is a cryptographically derived one-time ed25519 pubkey.
    /// Ownership of this account is maintained by whoever holds the spending key + ECDH scalar.
    #[account(mut)]
    pub stealth_recipient: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateMetaAddress<'info> {
    #[account(
        mut,
        seeds = [PREFIX_REGISTRY, owner.key().as_ref()],
        bump = registry.bump,
        has_one = owner @ StealfError::Unauthorized
    )]
    pub registry: Account<'info, StealthRegistry>,

    pub owner: Signer<'info>,
}

// ----------------------------------------------------------------------------
// State
// ----------------------------------------------------------------------------

#[account]
pub struct StealthRegistry {
    pub owner: Pubkey,          // 32
    pub spend_pubkey: [u8; 32], // 32
    pub view_pubkey: [u8; 32],  // 32
    pub metadata_uri: String,   // 4 + 128
    pub bump: u8,               // 1
    pub registered_at: i64,     // 8
}

impl StealthRegistry {
    pub const INIT_SPACE: usize = 32 + 32 + 32 + (4 + 128) + 1 + 8;
}

// ----------------------------------------------------------------------------
// Events
// ----------------------------------------------------------------------------

#[event]
pub struct MetaAddressRegisteredEvent {
    pub owner: Pubkey,
    pub spend_pubkey: [u8; 32],
    pub view_pubkey: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct StealthPaymentSentEvent {
    pub payer: Pubkey,
    pub stealth_recipient: Pubkey,
    pub ephemeral_pubkey: [u8; 32],
    pub amount: u64,
    pub memo: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct MetaAddressUpdatedEvent {
    pub owner: Pubkey,
    pub view_pubkey: [u8; 32],
    pub timestamp: i64,
}

// ----------------------------------------------------------------------------
// Error Codes
// ----------------------------------------------------------------------------

#[error_code]
pub enum StealfError {
    #[msg("Provided metadata URI exceeds maximum length of 128 bytes.")]
    MetadataTooLong,
    #[msg("Payment amount must be greater than zero.")]
    InvalidAmount,
    #[msg("Unauthorized signer for this registry.")]
    Unauthorized,
}