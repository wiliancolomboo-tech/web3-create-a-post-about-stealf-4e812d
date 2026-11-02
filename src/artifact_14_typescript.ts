import { ed25519 } from '@noble/curves/ed25519';
import { blake3 } from '@noble/hashes/blake3';
import { sha512 } from '@noble/hashes/sha512';
import { Keypair, PublicKey } from '@solana/web3.js';

export interface StealthMetaAddress {
  spendPubkey: Uint8Array;
  viewPubkey: Uint8Array;
}

export interface EphemeralStealthBundle {
  ephemeralPubkey: Uint8Array;
  ephemeralPrivkey: Uint8Array;
  stealthPubkey: PublicKey;
  viewTag: Uint8Array;
  sharedSecret: Uint8Array;
}

/**
 * Derives a shared secret between an ephemeral private key and recipient's view pubkey.
 */
export function deriveSharedSecretSender(
  ephemeralPrivkey: Uint8Array,
  recipientViewPubkey: Uint8Array
): Uint8Array {
  // Scalar multiplication on Curve25519
  const point = ed25519.ExtendedPoint.fromHex(recipientViewPubkey);
  // Derive scalar clamp from 32-byte secret seed
  const hash = sha512(ephemeralPrivkey);
  const scalar = BigInt('0x' + Buffer.from(hash.slice(0, 32)).reverse().toString('hex')) % ed25519.CURVE.n;
  const sharedPoint = point.multiply(scalar);
  return blake3(sharedPoint.toRawBytes());
}

/**
 * Derives a shared secret on the receiver side using recipient's view private key.
 */
export function deriveSharedSecretReceiver(
  viewPrivkey: Uint8Array,
  ephemeralPubkey: Uint8Array
): Uint8Array {
  const point = ed25519.ExtendedPoint.fromHex(ephemeralPubkey);
  const hash = sha512(viewPrivkey);
  const scalar = BigInt('0x' + Buffer.from(hash.slice(0, 32)).reverse().toString('hex')) % ed25519.CURVE.n;
  const sharedPoint = point.multiply(scalar);
  return blake3(sharedPoint.toRawBytes());
}

/**
 * Computes the 1-byte or 4-byte fast scan view-tag from the shared secret.
 */
export function computeViewTag(sharedSecret: Uint8Array): Uint8Array {
  const hash = blake3(Buffer.concat([sharedSecret, Buffer.from('view_tag')]));
  return hash.slice(0, 4);
}

/**
 * Computes a deterministic single-use stealth public key for Solana.
 */
export function generateStealthBundle(
  recipientSpendPubkey: Uint8Array,
  recipientViewPubkey: Uint8Array
): EphemeralStealthBundle {
  const ephemeralPrivkey = ed25519.utils.randomPrivateKey();
  const ephemeralPubkey = ed25519.getPublicKey(ephemeralPrivkey);

  const sharedSecret = deriveSharedSecretSender(ephemeralPrivkey, recipientViewPubkey);
  const viewTag = computeViewTag(sharedSecret);

  // Blinding scalar h = blake3(sharedSecret)
  const hScalar = BigInt('0x' + Buffer.from(blake3(sharedSecret)).toString('hex')) % ed25519.CURVE.n;
  const spendPoint = ed25519.ExtendedPoint.fromHex(recipientSpendPubkey);
  const blindedPoint = spendPoint.add(ed25519.ExtendedPoint.BASE.multiply(hScalar));
  
  const stealthPubkeyBytes = blindedPoint.toRawBytes();
  const stealthPubkey = new PublicKey(stealthPubkeyBytes);

  return {
    ephemeralPubkey,
    ephemeralPrivkey,
    stealthPubkey,
    viewTag,
    sharedSecret,
  };
}

/**
 * Reconstructs the stealth private key for sweeping funds.
 */
export function deriveStealthSpendingKey(
  spendPrivkey: Uint8Array,
  sharedSecret: Uint8Array
): Keypair {
  const hashSpend = sha512(spendPrivkey);
  const sScalar = BigInt('0x' + Buffer.from(hashSpend.slice(0, 32)).reverse().toString('hex')) % ed25519.CURVE.n;
  const hScalar = BigInt('0x' + Buffer.from(blake3(sharedSecret)).toString('hex')) % ed25519.CURVE.n;
  const derivedScalar = (sScalar + hScalar) % ed25519.CURVE.n;

  // Render to 32-byte private key representation
  const hex = derivedScalar.toString(16).padStart(64, '0');
  const derivedSecretBytes = Buffer.from(hex, 'hex').reverse();
  
  // Create Solana Keypair from derived private seed
  return Keypair.fromSeed(derivedSecretBytes);
}