use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use crate::errors::StealfError;
use crate::state::{StealthAnnouncement, VIEW_TAG_LENGTH};

#[event]
pub struct StealthSolTransferred {
    pub ephemeral_pubkey: Pubkey,
    pub stealth_pubkey: Pubkey,
    pub view_tag: [u8; VIEW_TAG_LENGTH],
    pub amount: u64,
    pub timestamp: i64,
}

#[derive(Accounts)]
#[instruction(ephemeral_pubkey: Pubkey, stealth_pubkey: Pubkey)]
pub struct AnnounceSol<'info> {
    #[account(
        init,
        payer = sender,
        space = StealthAnnouncement::LEN,
        seeds = [b"announcement", ephemeral_pubkey.as_ref(), stealth_pubkey.as_ref()],
        bump
    )]
    pub announcement: Account<'info, StealthAnnouncement>,

    #[account(mut)]
    pub sender: Signer<'info>,

    /// CHECK: Target disposable stealth account. Verified via caller derivation and funded directly.
    #[account(mut)]
    pub stealth_recipient: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<AnnounceSol>,
    ephemeral_pubkey: Pubkey,
    stealth_pubkey: Pubkey,
    view_tag: [u8; VIEW_TAG_LENGTH],
    amount: u64,
) -> Result<()> {
    require!(amount > 0, StealfError::ZeroTransferAmount);
    require_keys_eq!(ctx.accounts.stealth_recipient.key(), stealth_pubkey, StealfError::InvalidStealthAddress);

    // 1. Execute direct SOL transfer from sender to the disposable stealth address
    let cpi_context = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        Transfer {
            from: ctx.accounts.sender.to_account_info(),
            to: ctx.accounts.stealth_recipient.to_account_info(),
        },
    );
    transfer(cpi_context, amount)?;

    // 2. Populate announcement PDA for scanning
    let clock = Clock::get()?;
    let announcement = &mut ctx.accounts.announcement;
    announcement.ephemeral_pubkey = ephemeral_pubkey;
    announcement.stealth_pubkey = stealth_pubkey;
    announcement.view_tag = view_tag;
    announcement.amount = amount;
    announcement.mint = Pubkey::default();
    announcement.caller = ctx.accounts.sender.key();
    announcement.timestamp = clock.unix_timestamp;

    // 3. Emit real-time log event for streaming RPC nodes
    emit!(StealthSolTransferred {
        ephemeral_pubkey,
        stealth_pubkey,
        view_tag,
        amount,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}