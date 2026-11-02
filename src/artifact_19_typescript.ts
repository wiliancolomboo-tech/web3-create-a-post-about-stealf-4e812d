import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { StealfProgram } from "../target/types/stealf_program";
import { Keypair, SystemProgram, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import { ed25519 } from "@noble/curves/ed25519";
import { generateStealthAddress, checkAnnouncement, deriveStealthSpendingKey } from "../client/src/crypto";

describe("stealf-program: Enterprise Cryptographic and State Validation Suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.StealfProgram as Program<StealfProgram>;

  const recipientSpendPriv = ed25519.utils.randomPrivateKey();
  const recipientSpendPub = ed25519.getPublicKey(recipientSpendPriv);

  const recipientViewPriv = ed25519.utils.randomPrivateKey();
  const recipientViewPub = ed25519.getPublicKey(recipientViewPriv);

  const sender = Keypair.generate();
  const unauthorizedParty = Keypair.generate();

  before(async () => {
    // Airdrop SOL to test actors
    const sig1 = await provider.connection.requestAirdrop(sender.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    const sig2 = await provider.connection.requestAirdrop(unauthorizedParty.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig1);
    await provider.connection.confirmTransaction(sig2);
  });

  it("1. Successfully registers a Stealth Meta-Address PDA", async () => {
    const [metaPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("stealf-meta"), sender.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .registerMeta(Array.from(recipientSpendPub), Array.from(recipientViewPub))
      .accounts({
        authority: sender.publicKey,
        metaRecord: metaPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([sender])
      .rpc();

    const record = await program.account.metaRegistryRecord.fetch(metaPda);
    expect(record.authority.toBase58()).to.equal(sender.publicKey.toBase58());
    expect(Buffer.from(record.spendPubkey)).to.deep.equal(Buffer.from(recipientSpendPub));
    expect(Buffer.from(record.viewPubkey)).to.deep.equal(Buffer.from(recipientViewPub));
    expect(record.updatedAt.toNumber()).to.be.greaterThan(0);
  });

  it("2. Executes non-interactive stealth address generation and logs announcement", async () => {
    // SENDER: Derives stealth address and view tag
    const derivation = generateStealthAddress({
      spendPubkey: recipientSpendPub,
      viewPubkey: recipientViewPub,
    });

    const [announcementPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("stealf-announcement"),
        sender.publicKey.toBuffer(),
        Buffer.from(derivation.ephemeralPubkey),
      ],
      program.programId
    );

    const metadata = new Array(16).fill(0xaa); // Mock invoice hash

    await program.methods
      .announce(
        Array.from(derivation.ephemeralPubkey),
        derivation.stealthPubkey,
        derivation.viewTag,
        metadata
      )
      .accounts({
        sender: sender.publicKey,
        announcement: announcementPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([sender])
      .rpc();

    const storedAnnouncement = await program.account.announcementRecord.fetch(announcementPda);
    expect(storedAnnouncement.sender.toBase58()).to.equal(sender.publicKey.toBase58());
    expect(storedAnnouncement.stealthRecipient.toBase58()).to.equal(derivation.stealthPubkey.toBase58());
    expect(storedAnnouncement.viewTag).to.equal(derivation.viewTag);
    expect(Buffer.from(storedAnnouncement.metadata)).to.deep.equal(Buffer.from(metadata));
  });

  it("3. Fast-path filtering correctly identifies recipient transactions and rejects false positives", async () => {
    // Generate valid derivation
    const derivation = generateStealthAddress({
      spendPubkey: recipientSpendPub,
      viewPubkey: recipientViewPub,
    });

    // Check with true recipient view key
    const matchResult = checkAnnouncement(
      derivation.ephemeralPubkey,
      derivation.viewTag,
      derivation.stealthPubkey,
      recipientSpendPub,
      recipientViewPriv
    );
    expect(matchResult.isMatch).to.be.true;
    expect(matchResult.sharedSecret).to.not.be.undefined;

    // Check with arbitrary third-party view key (must fail)
    const thirdPartyViewPriv = ed25519.utils.randomPrivateKey();
    const thirdPartyMatch = checkAnnouncement(
      derivation.ephemeralPubkey,
      derivation.viewTag,
      derivation.stealthPubkey,
      recipientSpendPub,
      thirdPartyViewPriv
    );
    expect(thirdPartyMatch.isMatch).to.be.false;
  });

  it("4. Recipient derives spending private key and sweeps funds natively", async () => {
    // 1. Generate stealth address
    const derivation = generateStealthAddress({
      spendPubkey: recipientSpendPub,
      viewPubkey: recipientViewPub,
    });

    // 2. Fund the stealth address with SOL
    const transferIx = SystemProgram.transfer({
      fromPubkey: sender.publicKey,
      toPubkey: derivation.stealthPubkey,
      lamports: 1.5 * anchor.web3.LAMPORTS_PER_SOL,
    });
    const tx = new anchor.web3.Transaction().add(transferIx);
    await provider.sendAndConfirm(tx, [sender]);

    const initialBalance = await provider.connection.getBalance(derivation.stealthPubkey);
    expect(initialBalance).to.equal(1.5 * anchor.web3.LAMPORTS_PER_SOL);

    // 3. Derive spend key from shared secret
    const stealthPrivKey = deriveStealthSpendingKey(recipientSpendPriv, derivation.sharedSecret);
    const stealthKeypair = Keypair.fromSeed(stealthPrivKey);

    // Verify keypair pubkey aligns with derived stealth pubkey
    expect(stealthKeypair.publicKey.toBase58()).to.equal(derivation.stealthPubkey.toBase58());

    // 4. Sweep funds to cold destination
    const coldStorage = Keypair.generate();
    const sweepIx = SystemProgram.transfer({
      fromPubkey: stealthKeypair.publicKey,
      toPubkey: coldStorage.publicKey,
      lamports: initialBalance - 5000,
    });

    const sweepTx = new anchor.web3.Transaction().add(sweepIx);
    await provider.sendAndConfirm(sweepTx, [stealthKeypair]);

    const finalStealthBalance = await provider.connection.getBalance(derivation.stealthPubkey);
    const coldStorageBalance = await provider.connection.getBalance(coldStorage.publicKey);

    expect(finalStealthBalance).to.equal(0);
    expect(coldStorageBalance).to.equal(initialBalance - 5000);
  });

  it("5. Rejects registration with degenerate / zero points", async () => {
    const zeroKey = new Array(32).fill(0);
    const [metaPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("stealf-meta"), unauthorizedParty.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .registerMeta(zeroKey, zeroKey)
        .accounts({
          authority: unauthorizedParty.publicKey,
          metaRecord: metaPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([unauthorizedParty])
        .rpc();
      expect.fail("Expected transaction to fail on zero point");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("InvalidCurvePoint");
    }
  });
});