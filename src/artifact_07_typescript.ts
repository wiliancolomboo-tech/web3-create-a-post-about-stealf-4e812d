import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { PublicKey } from "@solana/web3.js";

export interface StealthMetaAddress {
  spendingPublicKey: Uint8Array; // 32 bytes
  viewingPublicKey: Uint8Array;  // 32 bytes
}

export interface EphemeralStealthResult {
  stealthPublicKey: PublicKey;
  ephemeralPublicKey: Uint8Array;
  viewTag: number;
  sharedSecret: Uint8Array;
}

export class StealfCrypto {
  /**
   * Generates a Stealth Meta-Address from spend and view private keys
   */
  public static deriveMetaAddress(
    spendPrivKey: Uint8Array,
    viewPrivKey: Uint8Array
  ): StealthMetaAddress {
    const spendingPublicKey = ed25519.getPublicKey(spendPrivKey);
    const viewingPublicKey = ed25519.getPublicKey(viewPrivKey);
    return { spendingPublicKey, viewingPublicKey };
  }

  /**
   * Sender derives a one-time stealth destination address and ephemeral public key
   */
  public static generateStealthAddress(
    meta: StealthMetaAddress
  ): EphemeralStealthResult {
    // 1. Generate ephemeral private scalar r
    const ephemeralPrivate = ed25519.utils.randomPrivateKey();
    const ephemeralPublicKey = ed25519.getPublicKey(ephemeralPrivate);

    // 2. Compute shared secret S = r * K_view
    // We use noble ed25519 point multiplication with clamp/scalar reduction
    const viewPoint = ed25519.ExtendedPoint.fromHex(Buffer.from(meta.viewingPublicKey).toString("hex"));
    const S_point = viewPoint.multiply(BigInt("0x" + Buffer.from(ephemeralPrivate).toString("hex")));
    const sharedSecret = sha256(S_point.toRawBytes());

    // 3. View tag = first byte of shared secret
    const viewTag = sharedSecret[0];

    // 4. Derive stealth pubkey P = K_spend + H(S)*G
    const hScalar = BigInt("0x" + Buffer.from(sharedSecret).toString("hex"));
    const hG = ed25519.ExtendedPoint.BASE.multiply(hScalar);
    const spendPoint = ed25519.ExtendedPoint.fromHex(Buffer.from(meta.spendingPublicKey).toString("hex"));
    const stealthPoint = spendPoint.add(hG);

    const stealthPublicKey = new PublicKey(stealthPoint.toRawBytes());

    return {
      stealthPublicKey,
      ephemeralPublicKey,
      viewTag,
      sharedSecret,
    };
  }

  /**
   * Receiver attempts to check if an announcement matches their viewing key
   */
  public static checkAnnouncement(
    ephemeralPublicKey: Uint8Array,
    viewTag: number,
    claimedStealthPubkey: PublicKey,
    viewPrivKey: Uint8Array,
    spendPubKey: Uint8Array
  ): { isMatch: boolean; sharedSecret?: Uint8Array } {
    // 1. Compute S = k_view * R
    const R_point = ed25519.ExtendedPoint.fromHex(Buffer.from(ephemeralPublicKey).toString("hex"));
    const S_point = R_point.multiply(BigInt("0x" + Buffer.from(viewPrivKey).toString("hex")));
    const sharedSecret = sha256(S_point.toRawBytes());

    // 2. Quick view tag check to discard non-matching records with 99.6% efficiency
    if (sharedSecret[0] !== viewTag) {
      return { isMatch: false };
    }

    // 3. Precise point validation
    const hScalar = BigInt("0x" + Buffer.from(sharedSecret).toString("hex"));
    const hG = ed25519.ExtendedPoint.BASE.multiply(hScalar);
    const spendPoint = ed25519.ExtendedPoint.fromHex(Buffer.from(spendPubKey).toString("hex"));
    const expectedStealthPoint = spendPoint.add(hG);
    const expectedPubkey = new PublicKey(expectedStealthPoint.toRawBytes());

    if (expectedPubkey.equals(claimedStealthPubkey)) {
      return { isMatch: true, sharedSecret };
    }

    return { isMatch: false };
  }

  /**
   * Receiver derives the private key for the one-time stealth address
   */
  public static deriveSpendingPrivateKey(
    spendPrivKey: Uint8Array,
    sharedSecret: Uint8Array
  ): Uint8Array {
    const kSpendScalar = BigInt("0x" + Buffer.from(spendPrivKey).toString("hex"));
    const hScalar = BigInt("0x" + Buffer.from(sharedSecret).toString("hex"));
    const CURVE_ORDER = ed25519.CURVE.n;
    const pScalar = (kSpendScalar + hScalar) % CURVE_ORDER;

    let hex = pScalar.toString(16).padStart(64, "0");
    return Uint8Array.from(Buffer.from(hex, "hex"));
  }
}