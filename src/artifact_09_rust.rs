use anchor_lang::prelude::*;
use anchor_spl::token::{transfer as spl_transfer, Mint, Token, TokenAccount, Transfer as SplTransfer};
use anchor_spl::associated_token::AssociatedToken;
use crate::errors::StealfError;
use crate::state::{StealthAnnouncement, VIEW_TAG_LENGTH};

#[event]
pub struct StealthTokenTransferred {
    pub ephemeral_pubkey: Pubkey,
    pub stealth_pubkey: Pubkey,
    pub view_tag: [u8; VIEW_TAG_LENGTH],
    pub mint: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[derive(Accounts)]
#[instruction(ephemeral_pubkey: Pubkey, stealth_pubkey: Pubkey)]
pub struct AnnounceToken<'info> {
    #[account(
        init,
        payer = sender,
        space = StealthAnnouncement::LEN,
        seeds = [b"token_announcement", ephemeral_pubkey.as_ref(), stealth_pubkey.as_ref()],
        bump
    )]
    pub announcement: Account<'info, StealthAnnouncement>,

    #[account(mut)]
    pub sender: Signer<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = sender
    )]
    pub sender_token_account: Account<'info, TokenAccount>,

    /// CHECK: Stealth recipient authority.
    pub stealth_recipient: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = sender,
        associated_token::mint = mint,
        associated_token::authority = stealth_recipient
    )]
    pub stealth_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<AnnounceToken>,
    ephemeral_pubkey: Pubkey,
    stealth_pubkey: Pubkey,
    view_tag: [u8; VIEW_TAG_LENGTH],
    amount: u64,
) -> Result<()> {
    require!(amount > 0, StealfError::ZeroTransferAmount);
    require_keys_eq!(ctx.accounts.stealth_recipient.key(), stealth_pubkey, StealfError::InvalidStealthAddress);

    // 1. Transfer SPL Tokens into recipient's disposable Associated Token Account
    let cpi_context = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        SplTransfer {
            from: ctx.accounts.sender_token_account.to_account_info(),
            to: ctx.accounts.stealth_token_account.to_account_info(),
            authority: ctx.accounts.sender.to_account_info(),
        },
    );
    spl_transfer(cpi_context, amount)?;

    // 2. Populate announcement PDA
    let clock = Clock::get()?;
    let announcement = &mut ctx.accounts.announcement;
    announcement.ephemeral_pubkey = ephemeral_pubkey;
    announcement.stealth_pubkey = stealth_pubkey;
    announcement.view_tag = view_tag;
    announcement.amount = amount;
    announcement.mint = ctx.accounts.mint.key();
    announcement.caller = ctx.accounts.sender.key();
    announcement.timestamp = clock.unix_timestamp;

    emit!(StealthTokenTransferred {
        ephemeral_pubkey,
        stealth_pubkey,
        view_tag,
        mint: ctx.accounts.mint.key(),
        amount,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}