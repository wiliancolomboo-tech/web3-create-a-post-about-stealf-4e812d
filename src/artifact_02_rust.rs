// File: /programs/stealf-core/src/lib.rs
use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("StEALF1111111111111111111111111111111111111");

pub const VIEW_TAG_SIZE: usize = 1;
pub const COMPRESSED_PUBKEY_SIZE: usize = 32;

#[program]
pub mod stealf_core {
    use super::*;

    /// Registers a user's dual-key stealth meta-address.
    pub fn register_meta_address(
        ctx: Context<RegisterMetaAddress>,
        spend_pubkey: [u8; 32],
        view_pubkey: [u8; 32],
    ) -> Result<()> {
        let registry = &mut ctx.accounts.stealth_meta_address;
        registry.owner = ctx.accounts.authority.key();
        registry.spend_pubkey = spend_pubkey;
        registry.view_pubkey = view_pubkey;
        registry.bump = ctx.bumps.stealth_meta_address;
        registry.registered_at = Clock::get()?.unix_timestamp;

        emit!(MetaAddressRegisteredEvent {
            owner: registry.owner,
            spend_pubkey,
            view_pubkey,
            timestamp: registry.registered_at,
        });

        Ok(())
    }

    /// Dispatches an announcement containing the ephemeral public key, view-tag,
    /// and destination stealth address. Sender transfers SOL directly to the derived stealth address.
    pub fn send_stealth_sol(
        ctx: Context<SendStealthSol>,
        ephemeral_pubkey: [u8; 32],
        view_tag: u8,
        stealth_recipient: Pubkey,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, StealfError::InvalidTransferAmount);
        require!(
            ctx.accounts.stealth_recipient.key() == stealth_recipient,
            StealfError::RecipientMismatch
        );

        // Native SOL transfer directly from sender to the derived stealth address
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.sender.to_account_info(),
                to: ctx.accounts.stealth_recipient.to_account_info(),
            },
        );
        system_program::transfer(cpi_context, amount)?;

        // Record announcement on-chain for off-chain scanning nodes
        let announcement = &mut ctx.accounts.announcement;
        announcement.sender = ctx.accounts.sender.key();
        announcement.stealth_recipient = stealth_recipient;
        announcement.ephemeral_pubkey = ephemeral_pubkey;
        announcement.view_tag = view_tag;
        announcement.amount = amount;
        announcement.slot = Clock::get()?.slot;
        announcement.timestamp = Clock::get()?.unix_timestamp;

        emit!(StealthAnnouncementEvent {
            sender: announcement.sender,
            stealth_recipient,
            ephemeral_pubkey,
            view_tag,
            amount,
            timestamp: announcement.timestamp,
        });

        Ok(())
    }

    /// Allows the authority to close their registry entry and reclaim rent.
    pub fn close_registry(_ctx: Context<CloseRegistry>) -> Result<()> {
        Ok(())
    }
}

// -----------------------------------------------------------------------------
// ACCOUNT VALIDATION CONTEXTS
// -----------------------------------------------------------------------------

#[derive(Accounts)]
pub struct RegisterMetaAddress<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + StealthMetaAddress::INIT_SPACE,
        seeds = [b"stealth_meta", authority.key().as_ref()],
        bump
    )]
    pub stealth_meta_address: Account<'info, StealthMetaAddress>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(ephemeral_pubkey: [u8; 32], view_tag: u8, stealth_recipient: Pubkey)]
pub struct SendStealthSol<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    /// CHECK: Validated against recipient parameter. Recipient is derived off-chain via ECDH.
    #[account(mut)]
    pub stealth_recipient: AccountInfo<'info>,

    #[account(
        init,
        payer = sender,
        space = 8 + AnnouncementRecord::INIT_SPACE,
        seeds = [
            b"announcement",
            sender.key().as_ref(),
            &Clock::get().unwrap().slot.to_le_bytes()
        ],
        bump
    )]
    pub announcement: Account<'info, AnnouncementRecord>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseRegistry<'info> {
    #[account(
        mut,
        close = authority,
        seeds = [b"stealth_meta", authority.key().as_ref()],
        bump = stealth_meta_address.bump,
        has_one = authority @ StealfError::UnauthorizedCaller
    )]
    pub stealth_meta_address: Account<'info, StealthMetaAddress>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

// -----------------------------------------------------------------------------
// STATE SCHEMAS
// -----------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct StealthMetaAddress {
    pub owner: Pubkey,
    pub spend_pubkey: [u8; 32],
    pub view_pubkey: [u8; 32],
    pub registered_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct AnnouncementRecord {
    pub sender: Pubkey,
    pub stealth_recipient: Pubkey,
    pub ephemeral_pubkey: [u8; 32],
    pub amount: u64,
    pub slot: u64,
    pub timestamp: i64,
    pub view_tag: u8,
}

// -----------------------------------------------------------------------------
// EVENTS & ERRORS
// -----------------------------------------------------------------------------

#[event]
pub struct MetaAddressRegisteredEvent {
    pub owner: Pubkey,
    pub spend_pubkey: [u8; 32],
    pub view_pubkey: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct StealthAnnouncementEvent {
    pub sender: Pubkey,
    pub stealth_recipient: Pubkey,
    pub ephemeral_pubkey: [u8; 32],
    pub view_tag: u8,
    pub amount: u64,
    pub timestamp: i64,
}

#[error_code]
pub enum StealfError {
    #[msg("Invalid transfer amount. Must be greater than zero.")]
    InvalidTransferAmount,
    #[msg("Stealth recipient account address does not match provided parameter.")]
    RecipientMismatch,
    #[msg("Signer does not have authority to close this stealth registry.")]
    UnauthorizedCaller,
}