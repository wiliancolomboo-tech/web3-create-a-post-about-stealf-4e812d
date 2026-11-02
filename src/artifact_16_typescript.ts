import { Command } from 'commander';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519';
import * as dotenv from 'dotenv';
import {
  generateStealthBundle,
  deriveSharedSecretReceiver,
  computeViewTag,
  deriveStealthSpendingKey
} from './crypto';
import { EnterpriseNotifier } from './notifications';

dotenv.config();

const PROGRAM_ID = new PublicKey(process.env.STEALF_PROGRAM_ID || "Stea1f1111111111111111111111111111111111111");
const RPC_ENDPOINT = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

const program = new Command();
program.name('stealf').description('Stealf Protocol CLI: Sovereign Non-Interactive Privacy on Solana').version('1.0.0');

// 1. Generate Meta-Address
program
  .command('generate-keys')
  .description('Generate new Spend and View keypairs for receiving stealth payments')
  .action(() => {
    const spendKey = ed25519.utils.randomPrivateKey();
    const viewKey = ed25519.utils.randomPrivateKey();

    const spendPub = ed25519.getPublicKey(spendKey);
    const viewPub = ed25519.getPublicKey(viewKey);

    console.log("=== Stealf Keys Generated (STORE SECURELY) ===");
    console.log("Private Spend Key:", Buffer.from(spendKey).toString('hex'));
    console.log("Private View Key: ", Buffer.from(viewKey).toString('hex'));
    console.log("----------------------------------------------");
    console.log("Public Spend Key: ", Buffer.from(spendPub).toString('hex'));
    console.log("Public View Key:  ", Buffer.from(viewPub).toString('hex'));
    console.log("==============================================");
  });

// 2. Transfer SOL to Stealth Address
program
  .command('send-sol')
  .requiredOption('-k, --keypair <path>', 'Sender Solana keypair JSON')
  .requiredOption('-s, --spend-pubkey <hex>', 'Recipient Public Spend Key')
  .requiredOption('-v, --view-pubkey <hex>', 'Recipient Public View Key')
  .requiredOption('-a, --amount <sol>', 'Amount of SOL to transfer')
  .action(async (options) => {
    const connection = new Connection(RPC_ENDPOINT, 'confirmed');
    const sender = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(require('fs').readFileSync(options.keypair, 'utf-8')))
    );

    const spendPubkey = Buffer.from(options.spendPubkey, 'hex');
    const viewPubkey = Buffer.from(options.viewPubkey, 'hex');
    const lamports = Math.floor(parseFloat(options.amount) * LAMPORTS_PER_SOL);

    console.log(`[Stealf] Deriving one-time disposable stealth address...`);
    const bundle = generateStealthBundle(spendPubkey, viewPubkey);

    console.log(`[Stealf] Ephemeral Pubkey (R):`, Buffer.from(bundle.ephemeralPubkey).toString('hex'));
    console.log(`[Stealf] View Tag:`, Buffer.from(bundle.viewTag).toString('hex'));
    console.log(`[Stealf] Target Stealth Pubkey:`, bundle.stealthPubkey.toBase58());

    // Build Instruction: Transfer SOL directly to the derived Stealth Pubkey
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: bundle.stealthPubkey,
        lamports,
      })
    );

    const sig = await sendAndConfirmTransaction(connection, tx, [sender]);
    console.log(`[Stealf] Payment Settled! TX Signature: ${sig}`);
    console.log(`Verify: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  });

// 3. Daemon Scanner & Auto-Sweeper
program
  .command('scanner-daemon')
  .requiredOption('--view-privkey <hex>', 'Receiver View Private Key (k_view)')
  .requiredOption('--spend-privkey <hex>', 'Receiver Spend Private Key (k_spend)')
  .requiredOption('--sweep-to <pubkey>', 'Cold Storage destination address')
  .action(async (options) => {
    const connection = new Connection(RPC_ENDPOINT, 'confirmed');
    const notifier = new EnterpriseNotifier();
    const viewPrivkey = Buffer.from(options.viewPrivkey, 'hex');
    const spendPrivkey = Buffer.from(options.spendPrivkey, 'hex');
    const sweepDestination = new PublicKey(options.sweepTo);

    console.log(`[Scanner] Stealf Daemon active. Monitoring on-chain announcements...`);
    console.log(`[Scanner] Auto-sweep destination: ${sweepDestination.toBase58()}`);

    // Listen to account updates or poll program announcements
    setInterval(async () => {
      // In production, subscribe via RPC websocket to program account updates
      process.stdout.write(".");
    }, 5000);
  });

program.parse(process.argv);