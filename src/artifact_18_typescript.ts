import { Command } from 'commander';
import { Keypair, Connection, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { generateStealthAddress, deriveStealthSpendingKey } from './crypto';

dotenv.config();

const program = new Command();
program.name('stealf-cli').description('Enterprise Stealf Protocol Operator CLI').version('1.0.0');

// 1. Generate Meta-Address
program
  .command('keygen')
  .description('Generate a new master dual-key stealth meta-address')
  .action(() => {
    const spendPriv = ed25519.utils.randomPrivateKey();
    const spendPub = ed25519.getPublicKey(spendPriv);

    const viewPriv = ed25519.utils.randomPrivateKey();
    const viewPub = ed25519.getPublicKey(viewPriv);

    const keys = {
      spendPrivateKey: Buffer.from(spendPriv).toString('hex'),
      spendPublicKey: Buffer.from(spendPub).toString('hex'),
      viewPrivateKey: Buffer.from(viewPriv).toString('hex'),
      viewPublicKey: Buffer.from(viewPub).toString('hex'),
      metaAddress: `${Buffer.from(spendPub).toString('hex')}:${Buffer.from(viewPub).toString('hex')}`
    };

    console.log("=== STEALF IDENTITY GENERATED ===");
    console.log(JSON.stringify(keys, null, 2));
    fs.writeFileSync('stealf-identity.json', JSON.stringify(keys, null, 2));
    console.log("\nSaved identity securely to 'stealf-identity.json'");
  });

// 2. Send Stealth Transfer
program
  .command('send')
  .description('Send confidential SOL to a recipient meta-address')
  .requiredOption('-m, --meta <metaAddress>', 'Recipient Meta Address (SpendPub:ViewPub)')
  .requiredOption('-a, --amount <sol>', 'Amount of SOL to transfer')
  .requiredOption('-k, --keypair <path>', 'Payer wallet keypair JSON path')
  .action(async (options) => {
    const [spendHex, viewHex] = options.meta.split(':');
    if (!spendHex || !viewHex) {
      throw new Error("Invalid meta-address format. Expected SpendPub:ViewPub in hex.");
    }

    const payerRaw = JSON.parse(fs.readFileSync(options.keypair, 'utf-8'));
    const payer = Keypair.fromSecretKey(Uint8Array.from(payerRaw));
    const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'confirmed');

    console.log(`Deriving stealth address...`);
    const stealthData = generateStealthAddress({
      spendPubkey: Buffer.from(spendHex, 'hex'),
      viewPubkey: Buffer.from(viewHex, 'hex')
    });

    console.log(`Stealth Destination Pubkey: ${stealthData.stealthPubkey.toBase58()}`);
    console.log(`Ephemeral Pubkey (R): ${Buffer.from(stealthData.ephemeralPubkey).toString('hex')}`);
    console.log(`View Tag: 0x${stealthData.viewTag.toString(16)}`);

    const lamports = Math.floor(parseFloat(options.amount) * 1e9);

    // 1. Transfer SOL directly to the derived stealth account
    const transferIx = SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: stealthData.stealthPubkey,
      lamports
    });

    const tx = new Transaction().add(transferIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [payer]);
    console.log(`Transfer complete! Signature: ${sig}`);
  });

// 3. Claim Stealth Account Funds
program
  .command('claim')
  .description('Derive spend key from shared secret and withdraw funds to cold storage')
  .requiredOption('-s, --spend-priv <hex>', 'Recipient Spend Private Key (hex)')
  .requiredOption('-v, --view-priv <hex>', 'Recipient View Private Key (hex)')
  .requiredOption('-e, --ephem-pub <hex>', 'Announcement Ephemeral Pubkey (hex)')
  .requiredOption('-d, --destination <pubkey>', 'Cold withdrawal destination pubkey')
  .action(async (options) => {
    const ephemPoint = ed25519.ExtendedPoint.fromHex(options.ephemPub);
    const viewScalar = BigInt('0x' + options.viewPriv);
    const sharedPoint = ephemPoint.multiply(viewScalar);
    const sharedSecret = sharedPoint.toRawBytes();

    const stealthPrivKey = deriveStealthSpendingKey(
      Buffer.from(options.spendPriv, 'hex'),
      sharedSecret
    );

    // Form Solana keypair from ed25519 scalar
    const stealthKeypair = Keypair.fromSeed(stealthPrivKey);
    console.log(`Stealth Derived Pubkey: ${stealthKeypair.publicKey.toBase58()}`);

    const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'confirmed');
    const balance = await connection.getBalance(stealthKeypair.publicKey);
    console.log(`Current Balance: ${balance / 1e9} SOL`);

    if (balance <= 5000) {
      console.log("Balance insufficient to cover transaction fee.");
      return;
    }

    const withdrawIx = SystemProgram.transfer({
      fromPubkey: stealthKeypair.publicKey,
      toPubkey: new PublicKey(options.destination),
      lamports: balance - 5000 // fee deduction
    });

    const tx = new Transaction().add(withdrawIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [stealthKeypair]);
    console.log(`Funds swept to cold storage! Tx: ${sig}`);
  });

program.parse(process.argv);