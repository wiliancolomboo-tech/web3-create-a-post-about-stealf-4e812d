use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;

declare_id!("Stea1f1111111111111111111111111111111111111");

#[program]
pub mod stealf_core {
    use super::*;

    /// Initialize Global Registry configuration
    pub fn initialize_registry(
        ctx: Context<InitializeRegistry>,
        protocol_fee_bps: u16,
    ) -> Result<()> {
        require!(protocol_fee_bps <= 500, StealfError::FeeExceedsCap); // Max 5%
        let registry = &mut ctx.accounts.registry;
        registry.authority = ctx.accounts.authority.key();
        registry.announcement_count = 0;
        registry.protocol_fee_bps = protocol_fee_bps;
        registry.paused = false;
        emit!(RegistryInitialized {
            authority: registry.authority,
            protocol_fee_bps,
        });
        Ok(())
    }

    /// Emits a stealth transfer announcement on-chain.
    /// The ephemeral pubkey R and stealth address P_stealth are recorded to allow scanning.
    pub fn publish_announcement(
        ctx: Context<PublishAnnouncement>,
        ephemeral_pubkey: [u8; 32],
        stealth_recipient: Pubkey,
        view_tag: u8,
        metadata_hash: [u8; 32],
    ) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        require!(!registry.paused, StealfError::ProtocolPaused);

        let announcement = &mut ctx.accounts.announcement;
        announcement.sender = ctx.accounts.sender.key();
        announcement.ephemeral_pubkey = ephemeral_pubkey;
        announcement.stealth_recipient = stealth_recipient;
        announcement.view_tag = view_tag;
        announcement.metadata_hash = metadata_hash;
        announcement.timestamp = Clock::get()?.unix_timestamp;
        announcement.slot = Clock::get()?.slot;
        announcement.sequence = registry.announcement_count;

        registry.announcement_count = registry
            .announcement_count
            .checked_add(1)
            .ok_or(StealfError::ArithmeticOverflow)?;

        emit!(StealthAnnouncementEvent {
            sender: announcement.sender,
            ephemeral_pubkey,
            stealth_recipient,
            view_tag,
            sequence: announcement.sequence,
            timestamp: announcement.timestamp,
        });

        Ok(())
    }

    /// Emergency update fee or pause operations
    pub fn set_protocol_state(
        ctx: Context<SetProtocolState>,
        paused: bool,
        new_fee_bps: u16,
    ) -> Result<()> {
        require!(new_fee_bps <= 500, StealfError::FeeExceedsCap);
        let registry = &mut ctx.accounts.registry;
        registry.paused = paused;
        registry.protocol_fee_bps = new_fee_bps;
        emit!(StateUpdated {
            paused,
            fee_bps: new_fee_bps,
        });
        Ok(())
    }

    /// Direct Sweep Proxy Instruction:
    /// Allows spending from a stealth PDA if derived by deterministic stealth seeds,
    /// or acts as a verifiable execution hook.
    pub fn close_announcement_receipt(
        ctx: Context<CloseAnnouncementReceipt>,
    ) -> Result<()> {
        // Rent rebate returned to original sender or authorized receiver
        let announcement = &ctx.accounts.announcement;
        require!(
            ctx.accounts.signer.key() == announcement.sender
                || ctx.accounts.signer.key() == ctx.accounts.registry.authority,
            StealfError::UnauthorizedSweep
        );
        Ok(())
    }
}

// -----------------------------------------------------------------------------
// ACCOUNT CONTEXTS
// -----------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitializeRegistry<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + RegistryConfig::LEN,
        seeds = [b"stealf_registry"],
        bump
    )]
    pub registry: Account<'info, RegistryConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PublishAnnouncement<'info> {
    #[account(
        mut,
        seeds = [b"stealf_registry"],
        bump
    )]
    pub registry: Account<'info, RegistryConfig>,

    #[account(
        init,
        payer = sender,
        space = 8 + AnnouncementRecord::LEN,
        seeds = [
            b"announcement",
            registry.announcement_count.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub announcement: Account<'info, AnnouncementRecord>,

    #[account(mut)]
    pub sender: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetProtocolState<'info> {
    #[account(
        mut,
        seeds = [b"stealf_registry"],
        bump,
        has_one = authority @ StealfError::UnauthorizedAdmin
    )]
    pub registry: Account<'info, RegistryConfig>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct CloseAnnouncementReceipt<'info> {
    #[account(
        seeds = [b"stealf_registry"],
        bump
    )]
    pub registry: Account<'info, RegistryConfig>,

    #[account(
        mut,
        close = recipient_refund,
        seeds = [
            b"announcement",
            announcement.sequence.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub announcement: Account<'info, AnnouncementRecord>,

    pub signer: Signer<'info>,

    /// CHECK: Safe refund target recipient
    #[account(mut)]
    pub recipient_refund: AccountInfo<'info>,
}

// -----------------------------------------------------------------------------
// DATA STRUCTURES
// -----------------------------------------------------------------------------

#[account]
pub struct RegistryConfig {
    pub authority: Pubkey,         // 32
    pub announcement_count: u64,    // 8
    pub protocol_fee_bps: u16,      // 2
    pub paused: bool,               // 1
}

impl RegistryConfig {
    pub const LEN: usize = 32 + 8 + 2 + 1 + 16; // 59 bytes with alignment padding
}

#[account]
pub struct AnnouncementRecord {
    pub sender: Pubkey,             // 32
    pub ephemeral_pubkey: [u8; 32], // 32
    pub stealth_recipient: Pubkey,  // 32
    pub view_tag: u8,               // 1
    pub metadata_hash: [u8; 32],    // 32
    pub timestamp: i64,             // 8
    pub slot: u64,                  // 8
    pub sequence: u64,              // 8
}

impl AnnouncementRecord {
    pub const LEN: usize = 32 + 32 + 32 + 1 + 32 + 8 + 8 + 8 + 16; // 169 bytes with padding
}

// -----------------------------------------------------------------------------
// EVENTS & ERRORS
// -----------------------------------------------------------------------------

#[event]
pub struct RegistryInitialized {
    pub authority: Pubkey,
    pub protocol_fee_bps: u16,
}

#[event]
pub struct StealthAnnouncementEvent {
    pub sender: Pubkey,
    pub ephemeral_pubkey: [u8; 32],
    pub stealth_recipient: Pubkey,
    pub view_tag: u8,
    pub sequence: u64,
    pub timestamp: i64,
}

#[event]
pub struct StateUpdated {
    pub paused: bool,
    pub fee_bps: u16,
}

#[error_code]
pub enum StealfError {
    #[msg("Protocol fee exceeds maximum allowed basis points (500 bps).")]
    FeeExceedsCap,
    #[msg("The Stealf protocol is currently paused.")]
    ProtocolPaused,
    #[msg("Arithmetic overflow occurred in registry counters.")]
    ArithmeticOverflow,
    #[msg("Caller is not authorized to execute administrative commands.")]
    UnauthorizedAdmin,
    #[msg("Caller is not authorized to reclaim this announcement receipt.")]
    UnauthorizedSweep,
}