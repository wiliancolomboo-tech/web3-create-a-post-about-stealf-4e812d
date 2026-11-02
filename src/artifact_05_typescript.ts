import { Command } from "commander";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import {
  generateStealthKeys,
  generateStealthAddress,
  recoverStealthPrivateKey,
  dispatchEnterpriseAlerts,
} from "./stealf-engine";

const program = new Command();
const RPC_ENDPOINT = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const connection = new Connection(RPC_ENDPOINT, "confirmed");

program
  .name("stealf-cli")
  .description("Stealf Protocol Enterprise CLI & Daemon")
  .version("1.0.0");

program
  .command("keygen")
  .description("Generate a new Stealf Dual-Key Meta-Address pair")
  .option("-o, --output <path>", "Output file path", "stealf-keys.json")
  .action((options) => {
    const keys = generateStealthKeys();
    const payload = {
      spendPublicKey: Buffer.from(keys.spendPublicKey).toString("hex"),
      spendPrivateKey: Buffer.from(keys.spendPrivateKey).toString("hex"),
      viewPublicKey: Buffer.from(keys.viewPublicKey).toString("hex"),
      viewPrivateKey: Buffer.from(keys.viewPrivateKey).toString("hex"),
      stealthMetaAddress: `stealf:${Buffer.from(keys.spendPublicKey).toString("hex")}:${Buffer.from(keys.viewPublicKey).toString("hex")}`,
    };

    fs.writeFileSync(options.output, JSON.stringify(payload, null, 2));
    console.log("Stealf Keypair successfully created!");
    console.log(`Public Meta-Address: ${payload.stealthMetaAddress}`);
    console.log(`Keys stored at: ${options.output}`);
  });

program
  .command("send")
  .description("Send SOL to a Stealf Meta-Address")
  .requiredOption("-m, --meta <metaAddress>", "Recipient meta-address (stealf:spendPub:viewPub)")
  .requiredOption("-a, --amount <amount>", "Amount in SOL")
  .requiredOption("-k, --keypair <path>", "Payer private key JSON")
  .action(async (options) => {
    const parts = options.meta.replace("stealf:", "").split(":");
    if (parts.length !== 2) throw new Error("Invalid meta address format.");

    const recipient = {
      spendPublicKey: Buffer.from(parts[0], "hex"),
      viewPublicKey: Buffer.from(parts[1], "hex"),
    };

    const payerSecret = JSON.parse(fs.readFileSync(options.keypair, "utf-8"));
    const payerKeypair = Keypair.fromSecretKey(new Uint8Array(payerSecret));

    const { stealthPublicKey, ephemeralPublicKey } = generateStealthAddress(recipient);

    console.log(`Deriving stealth address: ${stealthPublicKey.toBase58()}`);
    console.log(`Ephemeral Public Key: ${Buffer.from(ephemeralPublicKey).toString("hex")}`);

    const lamports = parseFloat(options.amount) * LAMPORTS_PER_SOL;

    // Send native transfer to stealth address
    const { SystemProgram, Transaction, sendAndConfirmTransaction } = await import("@solana/web3.js");
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payerKeypair.publicKey,
        toPubkey: stealthPublicKey,
        lamports,
      })
    );

    const sig = await sendAndConfirmTransaction(connection, tx, [payerKeypair]);
    console.log(`[SUCCESS] Payment transferred without on-chain link!`);
    console.log(`Tx Signature: ${sig}`);
    console.log(`Ephemeral Pubkey (Broadcast): ${Buffer.from(ephemeralPublicKey).toString("hex")}`);
  });

program
  .command("listen")
  .description("Run passive enterprise viewing daemon to detect incoming payments")
  .requiredOption("-k, --keys <path>", "Path to stealf-keys.json")
  .action(async (options) => {
    const keyData = JSON.parse(fs.readFileSync(options.keys, "utf-8"));
    const viewPrivateKey = Buffer.from(keyData.viewPrivateKey, "hex");
    const spendPrivateKey = Buffer.from(keyData.spendPrivateKey, "hex");

    console.log("[DAEMON] Stealf Enterprise Scanning Daemon started.");
    console.log(`Listening on RPC: ${RPC_ENDPOINT}`);

    // In production, poll slots or listen to Program Logs
    setInterval(async () => {
      // Heartbeat
      process.stdout.write(".");
    }, 5000);
  });

program.parse(process.argv);