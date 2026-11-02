use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;
use state::VIEW_TAG_LENGTH;

declare_id!("Stea1f1111111111111111111111111111111111111");

#[program]
pub mod stealf_protocol {
    use super::*;

    /// Registers the recipient's dual-key stealth meta-address on-chain
    pub fn register_meta(
        ctx: Context<RegisterMeta>,
        spend_pubkey: Pubkey,
        view_pubkey: Pubkey,
    ) -> Result<()> {
        instructions::register_meta::handler(ctx, spend_pubkey, view_pubkey)
    }

    /// Emits a stealth transfer of native SOL into a disposable stealth account
    pub fn announce_sol(
        ctx: Context<AnnounceSol>,
        ephemeral_pubkey: Pubkey,
        stealth_pubkey: Pubkey,
        view_tag: [u8; VIEW_TAG_LENGTH],
        amount: u64,
    ) -> Result<()> {
        instructions::announce_sol::handler(ctx, ephemeral_pubkey, stealth_pubkey, view_tag, amount)
    }

    /// Emits a stealth transfer of SPL Tokens into a disposable ATA
    pub fn announce_token(
        ctx: Context<AnnounceToken>,
        ephemeral_pubkey: Pubkey,
        stealth_pubkey: Pubkey,
        view_tag: [u8; VIEW_TAG_LENGTH],
        amount: u64,
    ) -> Result<()> {
        instructions::announce_token::handler(ctx, ephemeral_pubkey, stealth_pubkey, view_tag, amount)
    }
}