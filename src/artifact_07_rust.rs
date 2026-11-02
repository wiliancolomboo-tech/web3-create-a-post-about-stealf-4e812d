use anchor_lang::prelude::*;
use crate::state::{StealthMetaRegistry, DISCRIMINATOR_LENGTH};

#[derive(Accounts)]
pub struct RegisterMeta<'info> {
    #[account(
        init,
        payer = authority,
        space = StealthMetaRegistry::LEN,
        seeds = [b"stealf_meta", authority.key().as_ref()],
        bump
    )]
    pub meta_registry: Account<'info, StealthMetaRegistry>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<RegisterMeta>,
    spend_pubkey: Pubkey,
    view_pubkey: Pubkey,
) -> Result<()> {
    let registry = &mut ctx.accounts.meta_registry;
    registry.spend_pubkey = spend_pubkey;
    registry.view_pubkey = view_pubkey;
    registry.registered_at = Clock::get()?.unix_timestamp;
    registry.bump = ctx.bumps.meta_registry;
    
    msg!(
        "Stealf Meta Registry initialized for authority: {}. View: {}, Spend: {}",
        ctx.accounts.authority.key(),
        view_pubkey,
        spend_pubkey
    );
    Ok(())
}