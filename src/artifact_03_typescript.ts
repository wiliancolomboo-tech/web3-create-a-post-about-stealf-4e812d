// File: /client/src/stealf-client.ts
import * as anchor from "@coral-xyz/anchor";
import { Program, Idl } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import * as crypto from "crypto";
import axios from "axios";

export interface StealfMetaAddress {
  spendPubKey: Buffer; // 32 bytes
  viewPubKey: Buffer;  // 32 bytes
}

export interface EnterpriseNotificationPayload {
  recipient: string;
  stealthAddress: string;
  amountSol: number;
  txSignature: string;
  timestamp: string;
}

export class StealfEngine {
  private connection: Connection;
  private programId: PublicKey;

  constructor(rpcUrl: string, programIdStr: string) {
    this.connection = new Connection(rpcUrl, "confirmed");
    this.programId = new PublicKey(programIdStr);
  }

  /**
   * Generates a Dual-Key Stealth Meta-Address for Bob.
   */
  public static generateMetaAddress(): {
    spendKeypair: Keypair;
    viewKeypair: Keypair;
    metaAddress: StealfMetaAddress;
  } {
    const spendKeypair = Keypair.generate();
    const viewKeypair = Keypair.generate();
    return {
      spendKeypair,
      viewKeypair,
      metaAddress: {
        spendPubKey: Buffer.from(spendKeypair.publicKey.toBytes()),
        viewPubKey: Buffer.from(viewKeypair.publicKey.toBytes()),
      },
    };
  }

  /**
   * Derives a stealth destination address and view-tag from Bob's meta-address (Alice's side).
   */
  public static deriveStealthTarget(meta: StealfMetaAddress): {
    ephemeralKeypair: Keypair;
    stealthPublicKey: PublicKey;
    viewTag: number;
    sharedSecret: Buffer;
  } {
    const ephemeralKeypair = Keypair.generate();

    // Compute Diffie-Hellman Shared Secret: S = H(ephemeral_secret || meta.viewPubKey)
    const ecdhHash = crypto.createHash("sha256");
    ecdhHash.update(ephemeralKeypair.secretKey.subarray(0, 32));
    ecdhHash.update(meta.viewPubKey);
    const sharedSecret = ecdhHash.digest();

    // 1-Byte View-Tag: First byte of SHA256(sharedSecret)
    const viewTagHash = crypto.createHash("sha256").update(sharedSecret).digest();
    const viewTag = viewTagHash[0];

    // Compute Stealth Public Key: P_stealth = SHA256(sharedSecret || meta.spendPubKey)
    const stealthSeed = crypto.createHash("sha256")
      .update(sharedSecret)
      .update(meta.spendPubKey)
      .digest();

    // Deterministically generate Solana public key from the blended entropy
    const stealthKeypair = Keypair.fromSeed(stealthSeed);

    return {
      ephemeralKeypair,
      stealthPublicKey: stealthKeypair.publicKey,
      viewTag,
      sharedSecret,
    };
  }

  /**
   * Scans a candidate announcement using Bob's view private key.
   */
  public static checkAnnouncementMatch(
    ephemeralPubkey: Buffer,
    viewTag: number,
    bobViewSecret: Buffer,
    bobSpendPubkey: Buffer,
    candidateStealthAddress: PublicKey
  ): boolean {
    // 1. Recompute candidate shared secret from Bob's perspective
    const ecdhHash = crypto.createHash("sha256");
    ecdhHash.update(bobViewSecret.subarray(0, 32));
    ecdhHash.update(ephemeralPubkey);
    const sharedSecret = ecdhHash.digest();

    // 2. Compute View-Tag check (O(1) fast path)
    const expectedViewTag = crypto.createHash("sha256").update(sharedSecret).digest()[0];
    if (expectedViewTag !== viewTag) {
      return false; // Fast discard (99.6% rate)
    }

    // 3. Full derivation verification
    const stealthSeed = crypto.createHash("sha256")
      .update(sharedSecret)
      .update(bobSpendPubkey)
      .digest();
    const derivedPubkey = Keypair.fromSeed(stealthSeed).publicKey;

    return derivedPubkey.equals(candidateStealthAddress);
  }

  /**
   * Enterprise Webhook Dispatcher
   */
  public static async notifyEnterprise(
    payload: EnterpriseNotificationPayload,
    config: {
      slackWebhookUrl?: string;
      discordWebhookUrl?: string;
      resendApiKey?: string;
      resendRecipientEmail?: string;
    }
  ): Promise<void> {
    const formattedMsg = `🔒 [Stealf Protocol] Inbound Private Payment Detected!\n• Destination: ${payload.stealthAddress}\n• Amount: ${payload.amountSol} SOL\n• TX: ${payload.txSignature}\n• Timestamp: ${payload.timestamp}`;

    // Slack
    if (config.slackWebhookUrl) {
      try {
        await axios.post(config.slackWebhookUrl, { text: formattedMsg });
      } catch (err) {
        console.error("Failed to dispatch Slack webhook:", err);
      }
    }

    // Discord
    if (config.discordWebhookUrl) {
      try {
        await axios.post(config.discordWebhookUrl, {
          embeds: [
            {
              title: "Stealf Private Payment Received",
              color: 0x00ff88,
              fields: [
                { name: "Stealth Recipient", value: payload.stealthAddress, inline: false },
                { name: "Amount", value: `${payload.amountSol} SOL`, inline: true },
                { name: "Transaction", value: payload.txSignature, inline: false },
              ],
              timestamp: payload.timestamp,
            },
          ],
        });
      } catch (err) {
        console.error("Failed to dispatch Discord webhook:", err);
      }
    }

    // Resend Email API
    if (config.resendApiKey && config.resendRecipientEmail) {
      try {
        await axios.post(
          "https://api.resend.com/emails",
          {
            from: "stealf-notifications@resend.dev",
            to: config.resendRecipientEmail,
            subject: `Stealf Confidential Payment: +${payload.amountSol} SOL Received`,
            text: formattedMsg,
          },
          {
            headers: {
              Authorization: `Bearer ${config.resendApiKey}`,
              "Content-Type": "application/json",
            },
          }
        );
      } catch (err) {
        console.error("Failed to send Resend email alert:", err);
      }
    }
  }
}