import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { StealfCore } from "../target/types/stealf_core";
import { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import { StealfCrypto } from "../src/crypto";
import { ed25519 } from "@noble/curves/ed25519";

describe("stealf-core protocol suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.StealfCore as Program<StealfCore>;

  const recipientSpendPriv = ed25519.utils.randomPrivateKey();
  const recipientViewPriv = ed25519.utils.randomPrivateKey();
  const metaAddress = StealfCrypto.deriveMetaAddress(recipientSpendPriv, recipientViewPriv);

  const sender = Keypair.generate();

  before(async () => {
    // Fund sender wallet
    const signature = await provider.connection.requestAirdrop(
      sender.publicKey,
      5 * LAMPORTS_PER_SOL
    );
    const latestBlockhash = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({
      signature,
      ...latestBlockhash,
    });
  });

  it("Registers a Stealth Meta-Address on-chain", async () => {
    const [registryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("stealf_registry"), sender.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .registerMetaAddress(
        Array.from(metaAddress.spendingPublicKey),
        Array.from(metaAddress.viewingPublicKey)
      )
      .accounts({
        registryEntry: registryPda,
        authority: sender.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([sender])
      .rpc();

    const record = await program.account.stealthRegistryEntry.fetch(registryPda);
    expect(record.owner.toBase58()).to.equal(sender.publicKey.toBase58());
    expect(Buffer.from(record.spendingPubkey).toString("hex")).to.equal(
      Buffer.from(metaAddress.spendingPublicKey).toString("hex")
    );
    expect(Buffer.from(record.viewingPubkey).toString("hex")).to.equal(
      Buffer.from(metaAddress.viewingPublicKey).toString("hex")
    );
  });

  it("Executes stealth transfer and emits deterministic announcement", async () => {
    // 1. Generate stealth address client-side
    const stealthData = StealfCrypto.generateStealthAddress(metaAddress);

    const [announcementPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("stealf_announcement"),
        sender.publicKey.toBuffer(),
        Buffer.from(stealthData.ephemeralPublicKey),
      ],
      program.programId
    );

    // 2. Sender bundles transfer to stealth address and on-chain announcement
    const tx = new anchor.web3.Transaction();

    // Transfer SOL to one-time stealth address
    tx.add(
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: stealthData.stealthPublicKey,
        lamports: 1.5 * LAMPORTS_PER_SOL,
      })
    );

    // Program instruction recording ephemeral announcement
    const ix = await program.methods
      .emitAnnouncement(
        Array.from(stealthData.ephemeralPublicKey),
        stealthData.stealthPublicKey,
        stealthData.viewTag,
        Buffer.from("PAYROLL_OCT_2024")
      )
      .accounts({
        announcementRecord: announcementPda,
        sender: sender.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    tx.add(ix);

    const txSignature = await anchor.web3.sendAndConfirmTransaction(
      provider.connection,
      tx,
      [sender]
    );

    expect(txSignature).to.be.a("string");

    // 3. Confirm target stealth account holds funds
    const stealthBal = await provider.connection.getBalance(stealthData.stealthPublicKey);
    expect(stealthBal).to.equal(1.5 * LAMPORTS_PER_SOL);

    // 4. Validate Receiver trial decryption & key derivation
    const match = StealfCrypto.checkAnnouncement(
      stealthData.ephemeralPublicKey,
      stealthData.viewTag,
      stealthData.stealthPublicKey,
      recipientViewPriv,
      metaAddress.spendingPublicKey
    );

    expect(match.isMatch).to.be.true;
    expect(match.sharedSecret).to.not.be.undefined;

    // 5. Derive private spending key and verify keypair matches stealth address
    const spendingPriv = StealfCrypto.deriveSpendingPrivateKey(
      recipientSpendPriv,
      match.sharedSecret!
    );
    const derivedPubkeyBytes = ed25519.getPublicKey(spendingPriv);
    const derivedPubkey = new PublicKey(derivedPubkeyBytes);

    expect(derivedPubkey.equals(stealthData.stealthPublicKey)).to.be.true;
  });

  it("Rejects announcements exceeding maximum metadata capacity", async () => {
    const dummyEphemeral = new Uint8Array(32).fill(7);
    const dummyStealth = Keypair.generate().publicKey;
    const oversizedMetadata = Buffer.alloc(33, "A"); // Max allowed is 32

    const [announcementPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("stealf_announcement"),
        sender.publicKey.toBuffer(),
        Buffer.from(dummyEphemeral),
      ],
      program.programId
    );

    try {
      await program.methods
        .emitAnnouncement(
          Array.from(dummyEphemeral),
          dummyStealth,
          0x42,
          oversizedMetadata
        )
        .accounts({
          announcementRecord: announcementPda,
          sender: sender.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([sender])
        .rpc();

      expect.fail("Should have failed with MetadataTooLarge error");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("MetadataTooLarge");
    }
  });
});