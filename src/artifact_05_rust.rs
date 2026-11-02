use anchor_lang::prelude::*;

declare_id!("SteALF1111111111111111111111111111111111111");

pub const MAX_METADATA_LEN: usize = 32;

#[program]
pub mod stealf_core {
    use super::*;

    /// Initializes a user's Stealth Meta-Address registry entry on-chain.
    /// Allows counterparties to query spending and viewing keys directly by identity pubkey.
    pub fn register_meta_address(
        ctx: Context<RegisterMetaAddress>,
        spending_pubkey: [u8; 32],
        viewing_pubkey: [u8; 32],
    ) -> Result<()> {
        let registry = &mut ctx.accounts.registry_entry;
        registry.owner = ctx.accounts.authority.key();
        registry.spending_pubkey = spending_pubkey;
        registry.viewing_pubkey = viewing_pubkey;
        registry.registered_at = Clock::get()?.unix_timestamp;
        registry.bump = ctx.bumps.registry_entry;

        emit!(MetaAddressRegisteredEvent {
            owner: registry.owner,
            spending_pubkey,
            viewing_pubkey,
            timestamp: registry.registered_at,
        });

        Ok(())
    }

    /// Emits a cryptographically verifiable stealth announcement.
    /// Contains the ephemeral public key R, the derived destination stealth address,
    /// a 1-byte view tag filter for high-speed scanning, and arbitrary optional metadata.
    pub fn emit_announcement(
        ctx: Context<EmitAnnouncement>,
        ephemeral_pubkey: [u8; 32],
        stealth_recipient: Pubkey,
        view_tag: u8,
        metadata: Vec<u8>,
    ) -> Result<()> {
        require!(
            metadata.len() <= MAX_METADATA_LEN,
            StealfError::MetadataTooLarge
        );

        let announcement_record = &mut ctx.accounts.announcement_record;
        announcement_record.sender = ctx.accounts.sender.key();
        announcement_record.ephemeral_pubkey = ephemeral_pubkey;
        announcement_record.stealth_recipient = stealth_recipient;
        announcement_record.view_tag = view_tag;
        announcement_record.metadata = metadata.clone();
        announcement_record.timestamp = Clock::get()?.unix_timestamp;
        announcement_record.bump = ctx.bumps.announcement_record;

        emit!(StealthPaymentAnnouncedEvent {
            sender: ctx.accounts.sender.key(),
            ephemeral_pubkey,
            stealth_recipient,
            view_tag,
            metadata,
            timestamp: announcement_record.timestamp,
        });

        Ok(())
    }
}

// ----------------------------------------------------------------------------
// ACCOUNTS CONTEXTS
// ----------------------------------------------------------------------------

#[derive(Accounts)]
pub struct RegisterMetaAddress<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + StealthRegistryEntry::INIT_SPACE,
        seeds = [b"stealf_registry", authority.key().as_ref()],
        bump
    )]
    pub registry_entry: Account<'info, StealthRegistryEntry>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(ephemeral_pubkey: [u8; 32], stealth_recipient: Pubkey)]
pub struct EmitAnnouncement<'info> {
    #[account(
        init,
        payer = sender,
        space = 8 + StealthAnnouncement::INIT_SPACE,
        seeds = [
            b"stealf_announcement",
            sender.key().as_ref(),
            ephemeral_pubkey.as_ref()
        ],
        bump
    )]
    pub announcement_record: Account<'info, StealthAnnouncement>,

    #[account(mut)]
    pub sender: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// ----------------------------------------------------------------------------
// STATE SCHEMAS
// ----------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct StealthRegistryEntry {
    pub owner: Pubkey,              // 32
    pub spending_pubkey: [u8; 32],  // 32
    pub viewing_pubkey: [u8; 32],   // 32
    pub registered_at: i64,         // 8
    pub bump: u8,                   // 1
}

#[account]
#[derive(InitSpace)]
pub struct StealthAnnouncement {
    pub sender: Pubkey,             // 32
    pub ephemeral_pubkey: [u8; 32], // 32
    pub stealth_recipient: Pubkey,  // 32
    pub view_tag: u8,               // 1
    #[max_len(32)]
    pub metadata: Vec<u8>,          // 4 + 32
    pub timestamp: i64,             // 8
    pub bump: u8,                   // 1
}

// ----------------------------------------------------------------------------
// EVENTS
// ----------------------------------------------------------------------------

#[event]
pub struct MetaAddressRegisteredEvent {
    pub owner: Pubkey,
    pub spending_pubkey: [u8; 32],
    pub viewing_pubkey: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct StealthPaymentAnnouncedEvent {
    pub sender: Pubkey,
    pub ephemeral_pubkey: [u8; 32],
    pub stealth_recipient: Pubkey,
    pub view_tag: u8,
    pub metadata: Vec<u8>,
    pub timestamp: i64,
}

// ----------------------------------------------------------------------------
// ERRORS
// ----------------------------------------------------------------------------

#[error_code]
pub enum StealfError {
    #[msg("Announcement metadata exceeds allowed limit of 32 bytes.")]
    MetadataTooLarge,
    #[msg("Invalid cryptographic public key scalar provided.")]
    InvalidKeyLength,
}