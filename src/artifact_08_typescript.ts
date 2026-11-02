import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { StealfCrypto } from "./crypto";
import axios from "axios";
import * as dotenv from "dotenv";

dotenv.config();

const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const PROGRAM_ID = new PublicKey(process.env.STEALF_PROGRAM_ID || "SteALF1111111111111111111111111111111111111");
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;

export async function dispatchAlert(title: string, details: Record<string, any>) {
  if (!DISCORD_WEBHOOK) {
    console.log(`[ALERT] ${title}`, details);
    return;
  }
  try {
    await axios.post(DISCORD_WEBHOOK, {
      embeds: [
        {
          title: `🛡️ Stealf Protocol Alert: ${title}`,
          color: 0x14f195, // Solana Green
          fields: Object.entries(details).map(([k, v]) => ({
            name: k,
            value: String(v),
            inline: false,
          })),
          timestamp: new Date().toISOString(),
        },
      ],
    });
  } catch (err: any) {
    console.error("Failed to forward alert to webhook:", err.message);
  }
}

export async function runStealfScanner(
  viewPrivKeyHex: string,
  spendPubKeyHex: string
) {
  const connection = new Connection(RPC_URL, "confirmed");
  const viewPrivKey = Uint8Array.from(Buffer.from(viewPrivKeyHex, "hex"));
  const spendPubKey = Uint8Array.from(Buffer.from(spendPubKeyHex, "hex"));

  console.log("------------------------------------------------------------");
  console.log("🚀 Starting Stealf Scanning Daemon...");
  console.log(`📡 Connected to RPC: ${RPC_URL}`);
  console.log(`🔒 Active Viewing Key Filter: ${viewPrivKeyHex.slice(0, 10)}...`);
  console.log("------------------------------------------------------------");

  // Fetch program accounts for announcements
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [
      {
        dataSize: 8 + 32 + 32 + 32 + 1 + 36 + 8 + 1, // StealthAnnouncement schema size
      },
    ],
  });

  console.log(`Found ${accounts.length} total announcement records to evaluate.`);

  for (const acc of accounts) {
    const data = acc.account.data;
    // Skip 8-byte discriminator
    const offset = 8;
    const sender = new PublicKey(data.slice(offset, offset + 32));
    const ephemeralPubkey = data.slice(offset + 32, offset + 64);
    const stealthRecipient = new PublicKey(data.slice(offset + 64, offset + 96));
    const viewTag = data[offset + 96];

    const matchResult = StealfCrypto.checkAnnouncement(
      ephemeralPubkey,
      viewTag,
      stealthRecipient,
      viewPrivKey,
      spendPubKey
    );

    if (matchResult.isMatch) {
      const balance = await connection.getBalance(stealthRecipient);
      console.log(`\n🎉 MATCH IDENTIFIED!`);
      console.log(`Destination Account: ${stealthRecipient.toBase58()}`);
      console.log(`Current Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

      await dispatchAlert("Incoming Private Transfer Detected", {
        "Stealth Address": stealthRecipient.toBase58(),
        "Detected Balance": `${balance / LAMPORTS_PER_SOL} SOL`,
        "Sender": sender.toBase58(),
        "Ephemeral Pubkey": Buffer.from(ephemeralPubkey).toString("hex"),
      });
    }
  }
}

if (require.main === module) {
  const testViewKey = process.env.TEST_VIEW_KEY || "01".repeat(32);
  const testSpendPub = process.env.TEST_SPEND_PUB || "02".repeat(32);
  runStealfScanner(testViewKey, testSpendPub).catch(console.error);
}