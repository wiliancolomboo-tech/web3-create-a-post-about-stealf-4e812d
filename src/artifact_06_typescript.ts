import { expect } from "chai";
import * as ed from "@noble/ed25519";
import { PublicKey } from "@solana/web3.js";
import {
  generateStealthKeys,
  generateStealthAddress,
  recoverStealthPrivateKey,
} from "../client/stealf-engine";

describe("Stealf Protocol Cryptographic QA Suite", () => {
  it("should generate valid 32-byte Ed25519 keypairs for spend and view", () => {
    const keys = generateStealthKeys();
    expect(keys.spendPrivateKey).to.have.lengthOf(32);
    expect(keys.spendPublicKey).to.have.lengthOf(32);
    expect(keys.viewPrivateKey).to.have.lengthOf(32);
    expect(keys.viewPublicKey).to.have.lengthOf(32);
  });

  it("should derive an unlinkable stealth address and permit exact spending recovery", () => {
    // 1. Recipient generates keys
    const recipient = generateStealthKeys();

    // 2. Sender derives stealth address using Recipient's public keys
    const { stealthPublicKey, ephemeralPublicKey } = generateStealthAddress({
      spendPublicKey: recipient.spendPublicKey,
      viewPublicKey: recipient.viewPublicKey,
    });

    expect(stealthPublicKey).to.be.an.instanceOf(PublicKey);
    expect(ephemeralPublicKey).to.have.lengthOf(32);

    // 3. Recipient scans and recovers spending private key
    const recoveredPrivKey = recoverStealthPrivateKey(
      ephemeralPublicKey,
      recipient.spendPrivateKey,
      recipient.viewPrivateKey,
      stealthPublicKey
    );

    expect(recoveredPrivKey).to.not.be.null;

    // 4. Verify that the recovered private key strictly reproduces the stealth address
    const derivedPub = ed.getPublicKey(recoveredPrivKey!);
    const derivedAddress = new PublicKey(derivedPub);

    expect(derivedAddress.toBase58()).to.equal(stealthPublicKey.toBase58());
  });

  it("should fail to recover spending key if viewing key is incorrect", () => {
    const recipient = generateStealthKeys();
    const attacker = generateStealthKeys();

    const { stealthPublicKey, ephemeralPublicKey } = generateStealthAddress({
      spendPublicKey: recipient.spendPublicKey,
      viewPublicKey: recipient.viewPublicKey,
    });

    // Attacker attempts to recover with attacker view key
    const result = recoverStealthPrivateKey(
      ephemeralPublicKey,
      attacker.spendPrivateKey,
      attacker.viewPrivateKey,
      stealthPublicKey
    );

    expect(result).to.be.null;
  });

  it("should ensure deterministic one-way unlinkability (collision-free)", () => {
    const recipient = generateStealthKeys();

    // Generate two distinct payments to the same meta-address
    const pay1 = generateStealthAddress({
      spendPublicKey: recipient.spendPublicKey,
      viewPublicKey: recipient.viewPublicKey,
    });
    const pay2 = generateStealthAddress({
      spendPublicKey: recipient.spendPublicKey,
      viewPublicKey: recipient.viewPublicKey,
    });

    // Even though recipient is the same, stealth addresses must be completely distinct
    expect(pay1.stealthPublicKey.toBase58()).to.not.equal(pay2.stealthPublicKey.toBase58());
    expect(Buffer.from(pay1.ephemeralPublicKey).toString("hex")).to.not.equal(
      Buffer.from(pay2.ephemeralPublicKey).toString("hex")
    );
  });
});