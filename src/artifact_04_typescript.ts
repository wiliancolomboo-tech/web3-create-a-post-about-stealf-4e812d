import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { sha256 } from "@noble/hashes/sha256";
import axios from "axios";

// Noble ed25519 configuration
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

export const STEALF_PROGRAM_ID = new PublicKey(
  "StEALF1111111111111111111111111111111111111"
);

export interface StealthMetaAddress {
  spendPublicKey: Uint8Array; // 32 bytes
  viewPublicKey: Uint8Array;  // 32 bytes
}

export interface StealthKeys {
  spendPrivateKey: Uint8Array;
  spendPublicKey: Uint8Array;
  viewPrivateKey: Uint8Array;
  viewPublicKey: Uint8Array;
}

/**
 * Generates an Enterprise Stealf Key Pair.
 */
export function generateStealthKeys(): StealthKeys {
  const spendPriv = ed.utils.randomPrivateKey();
  const spendPub = ed.getPublicKey(spendPriv);

  const viewPriv = ed.utils.randomPrivateKey();
  const viewPub = ed.getPublicKey(viewPriv);

  return {
    spendPrivateKey: spendPriv,
    spendPublicKey: spendPub,
    viewPrivateKey: viewPriv,
    viewPublicKey: viewPub,
  };
}

/**
 * Sender-Side: Generates a one-time stealth destination address and ephemeral public key.
 * 
 * Math:
 * 1. Generate ephemeral secret r in [1, n-1], compute R = r * G
 * 2. Compute shared ECDH secret: S = r * View_Pubkey
 * 3. Compute scalar tweak: c = SHA256(S)
 * 4. Compute stealth public key: P_stealth = Spend_Pubkey + c * G
 */
export function generateStealthAddress(recipient: StealthMetaAddress): {
  stealthPublicKey: PublicKey;
  ephemeralPublicKey: Uint8Array;
  sharedSecret: Uint8Array;
} {
  const ephemeralPrivateKey = ed.utils.randomPrivateKey();
  const ephemeralPublicKey = ed.getPublicKey(ephemeralPrivateKey);

  // ECDH: S = ephemeralPrivateKey * viewPublicKey
  const viewPoint = ed.ExtendedPoint.fromHex(Buffer.from(recipient.viewPublicKey).toString("hex"));
  const ephemeralScalar = BigInt("0x" + Buffer.from(ephemeralPrivateKey).toString("hex"));
  const sharedPoint = viewPoint.multiply(ephemeralScalar);
  const sharedSecret = sha256(sharedPoint.toRawBytes());

  // c = scalar tweak
  const tweakScalar = BigInt("0x" + Buffer.from(sharedSecret).toString("hex"));
  const tweakPoint = ed.ExtendedPoint.BASE.multiply(tweakScalar);

  // P_stealth = Spend_Pubkey + tweakPoint
  const spendPoint = ed.ExtendedPoint.fromHex(Buffer.from(recipient.spendPublicKey).toString("hex"));
  const stealthPoint = spendPoint.add(tweakPoint);

  const stealthAddressBytes = stealthPoint.toRawBytes();
  const stealthPublicKey = new PublicKey(stealthAddressBytes);

  return {
    stealthPublicKey,
    ephemeralPublicKey,
    sharedSecret,
  };
}

/**
 * Recipient-Side: Checks if a given transaction belongs to this viewing key.
 * If match: derives the private spending key for that stealth account.
 */
export function recoverStealthPrivateKey(
  ephemeralPublicKey: Uint8Array,
  spendPrivateKey: Uint8Array,
  viewPrivateKey: Uint8Array,
  targetStealthPubkey: PublicKey
): Uint8Array | null {
  // S' = viewPrivateKey * Ephemeral_Pubkey
  const ephemPoint = ed.ExtendedPoint.fromHex(Buffer.from(ephemeralPublicKey).toString("hex"));
  const viewScalar = BigInt("0x" + Buffer.from(viewPrivateKey).toString("hex"));
  const sharedPoint = ephemPoint.multiply(viewScalar);
  const sharedSecret = sha256(sharedPoint.toRawBytes());

  // c' = SHA256(S')
  const tweakScalar = BigInt("0x" + Buffer.from(sharedSecret).toString("hex"));
  const tweakPoint = ed.ExtendedPoint.BASE.multiply(tweakScalar);

  // Spend_Pubkey + c' * G
  const spendPub = ed.getPublicKey(spendPrivateKey);
  const spendPoint = ed.ExtendedPoint.fromHex(Buffer.from(spendPub).toString("hex"));
  const expectedStealthPoint = spendPoint.add(tweakPoint);

  const expectedAddress = new PublicKey(expectedStealthPoint.toRawBytes());

  if (expectedAddress.equals(targetStealthPubkey)) {
    // Derive spending private key: s_stealth = (spendPrivateKey + tweakScalar) mod l
    const spendScalar = BigInt("0x" + Buffer.from(spendPrivateKey).toString("hex"));
    const CURVE_ORDER = BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed");
    const stealthPrivateScalar = (spendScalar + tweakScalar) % CURVE_ORDER;

    let hex = stealthPrivateScalar.toString(16);
    while (hex.length < 64) hex = "0" + hex;
    return Buffer.from(hex, "hex");
  }

  return null;
}

/**
 * Enterprise Dispatcher: Sends Webhook and Resend Notification.
 */
export async function dispatchEnterpriseAlerts(params: {
  amountSol: number;
  stealthAddress: string;
  signature: string;
  resendApiKey?: string;
  slackWebhookUrl?: string;
  recipientEmail?: string;
}) {
  const { amountSol, stealthAddress, signature, resendApiKey, slackWebhookUrl, recipientEmail } = params;

  console.log(`[ALERT] Inbound Stealth Payment Detected: ${amountSol} SOL -> ${stealthAddress}`);

  // 1. Dispatch Discord / Slack Webhook
  if (slackWebhookUrl) {
    try {
      await axios.post(slackWebhookUrl, {
        text: `🔒 *Stealf Inbound Payment Received*\n• *Amount:* ${amountSol} SOL\n• *Stealth Address:* \`${stealthAddress}\`\n• *Signature:* https://solscan.io/tx/${signature}`,
      });
      console.log("[TELEMETRY] Slack/Discord notification dispatched successfully.");
    } catch (err: any) {
      console.error("[ERROR] Failed to dispatch webhook:", err.message);
    }
  }

  // 2. Dispatch Enterprise Resend Email
  if (resendApiKey && recipientEmail) {
    try {
      await axios.post(
        "https://api.resend.com/emails",
        {
          from: "Stealf Security <receipts@stealf.protocol>",
          to: [recipientEmail],
          subject: `Confirmed: Private Inbound Transfer of ${amountSol} SOL`,
          html: `
            <h2>Stealf Protocol Payment Notice</h2>
            <p>A new unlinkable payment has been credited to your stealth address.</p>
            <ul>
              <li><strong>Amount:</strong> ${amountSol} SOL</li>
              <li><strong>Destination Stealth Account:</strong> <code>${stealthAddress}</code></li>
              <li><strong>Transaction Signature:</strong> <code>${signature}</code></li>
            </ul>
            <p>Your offline viewing daemon has indexed this transaction. Funds can be swept anytime with your spending key.</p>
          `,
        },
        {
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
        }
      );
      console.log("[TELEMETRY] Resend settlement receipt dispatched successfully.");
    } catch (err: any) {
      console.error("[ERROR] Failed to send Resend email:", err.message);
    }
  }
}