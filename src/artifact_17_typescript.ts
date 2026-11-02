import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { StealfProtocol } from "../target/types/stealf_protocol";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";
import { ed25519 } from "@noble/curves/ed25519";
import {
  generateStealthBundle,
  deriveSharedSecretReceiver,
  computeViewTag,
  deriveStealthSpendingKey
} from "../client/src/crypto";

describe("stealf-protocol comprehensive test suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.StealfProtocol as Program<StealfProtocol>;
  const sender = Keypair.generate();

  // Recipient Keypairs (DKSAP)
  const recipientSpendPriv = ed25519.utils.randomPrivateKey();
  const recipientViewPriv = ed25519.utils.randomPrivateKey();
  const recipientSpendPub = ed25519.getPublicKey(recipientSpendPriv);
  const recipientViewPub = ed25519.getPublicKey(recipientViewPriv);

  before(async () => {
    // Airdrop 5 SOL to sender
    const sig = await provider.connection.requestAirdrop(sender.publicKey, 5 * LAMPORTS_PER_SOL);
    const latestBlockHash = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({
      blockhash: latestBlockHash.blockhash,
      lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      signature: sig,
    });
  });

  it("1. Deterministically derives Stealth Keypair matching sender and receiver math", () => {
    // Sender side
    const bundle = generateStealthBundle(recipientSpendPub, recipientViewPub);

    // Receiver side
    const receiverSharedSecret = deriveSharedSecretReceiver(recipientViewPriv, bundle.ephemeralPubkey);
    const receiverViewTag = computeViewTag(receiverSharedSecret);

    // Assert fast-view tag matches
    assert.deepEqual(
      Buffer.from(bundle.viewTag),
      Buffer.from(receiverViewTag),
      "View tags must match exactly for O(1) scanning"
    );

    // Derive spending keypair
    const derivedSweeperKeypair = deriveStealthSpendingKey(recipientSpendPriv, receiverSharedSecret);
    assert.equal(
      derivedSweeperKeypair.publicKey.toBase58(),
      bundle.stealthPubkey.toBase58(),
      "Derived spending keypair public key must match sender stealth target"
    );
  });

  it("2. Registers recipient dual-key stealth meta on-chain", async () => {
    const [metaPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("stealf_meta"), sender.publicKey.toBuffer()],
      program.programId
    );

    const spendPubkey = new PublicKey(recipientSpendPub);
    const viewPubkey = new PublicKey(recipientViewPub);

    await program.methods
      .registerMeta(spendPubkey, viewPubkey)
      .accounts({
        metaRegistry: metaPda,
        authority: sender.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([sender])
      .rpc();

    const account = await program.account.stealthMetaRegistry.fetch(metaPda);
    assert.isTrue(account.spendPubkey.equals(spendPubkey));
    assert.isTrue(account.viewPubkey.equals(viewPubkey));
  });

  it("3. Executes announce_sol: transfers SOL directly to disposable address & logs PDA", async () => {
    const bundle = generateStealthBundle(recipientSpendPub, recipientViewPub);
    const ephemeralPubkey = new PublicKey(bundle.ephemeralPubkey);
    const stealthPubkey = bundle.stealthPubkey;
    const viewTagArray = Array.from(bundle.viewTag);
    const transferAmount = new anchor.BN(1 * LAMPORTS_PER_SOL);

    const [announcementPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("announcement"), ephemeralPubkey.toBuffer(), stealthPubkey.toBuffer()],
      program.programId
    );

    const balanceBefore = await provider.connection.getBalance(stealthPubkey);

    await program.methods
      .announceSol(ephemeralPubkey, stealthPubkey, viewTagArray, transferAmount)
      .accounts({
        announcement: announcementPda,
        sender: sender.publicKey,
        stealthRecipient: stealthPubkey,
        systemProgram: SystemProgram.programId,
      })
      .signers([sender])
      .rpc();

    const balanceAfter = await provider.connection.getBalance(stealthPubkey);
    assert.equal(balanceAfter - balanceBefore, 1 * LAMPORTS_PER_SOL);

    const announcementState = await program.account.stealthAnnouncement.fetch(announcementPda);
    assert.isTrue(announcementState.ephemeralPubkey.equals(ephemeralPubkey));
    assert.isTrue(announcementState.stealthPubkey.equals(stealthPubkey));
    assert.equal(announcementState.amount.toNumber(), 1 * LAMPORTS_PER_SOL);
  });

  it("4. Recipient sweeps funds from disposable address using derived private key", async () => {
    const bundle = generateStealthBundle(recipientSpendPub, recipientViewPub);
    const ephemeralPubkey = new PublicKey(bundle.ephemeralPubkey);
    const stealthPubkey = bundle.stealthPubkey;
    const sweepAmount = 0.5 * LAMPORTS_PER_SOL;

    // Send funds to stealth address
    const [announcementPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("announcement"), ephemeralPubkey.toBuffer(), stealthPubkey.toBuffer()],
      program.programId
    );

    await program.methods
      .announceSol(ephemeralPubkey, stealthPubkey, Array.from(bundle.viewTag), new anchor.BN(sweepAmount))
      .accounts({
        announcement: announcementPda,
        sender: sender.publicKey,
        stealthRecipient: stealthPubkey,
        systemProgram: SystemProgram.programId,
      })
      .signers([sender])
      .rpc();

    // Receiver sweeps: derive signing keypair
    const sharedSecret = deriveSharedSecretReceiver(recipientViewPriv, bundle.ephemeralPubkey);
    const sweeperKeypair = deriveStealthSpendingKey(recipientSpendPriv, sharedSecret);

    const coldStorage = Keypair.generate().publicKey;
    const tx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sweeperKeypair.publicKey,
        toPubkey: coldStorage,
        lamports: sweepAmount - 5000, // subtract standard tx fee
      })
    );

    const sig = await anchor.web3.sendAndConfirmTransaction(provider.connection, tx, [sweeperKeypair]);
    assert.isOk(sig);

    const coldStorageBalance = await provider.connection.getBalance(coldStorage);
    assert.equal(coldStorageBalance, sweepAmount - 5000);
  });

  it("5. Rejects zero-amount stealth announcements", async () => {
    const bundle = generateStealthBundle(recipientSpendPub, recipientViewPub);
    const ephemeralPubkey = new PublicKey(bundle.ephemeralPubkey);
    const stealthPubkey = bundle.stealthPubkey;

    const [announcementPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("announcement"), ephemeralPubkey.toBuffer(), stealthPubkey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .announceSol(ephemeralPubkey, stealthPubkey, Array.from(bundle.viewTag), new anchor.BN(0))
        .accounts({
          announcement: announcementPda,
          sender: sender.publicKey,
          stealthRecipient: stealthPubkey,
          systemProgram: SystemProgram.programId,
        })
        .signers([sender])
        .rpc();
      assert.fail("Should have thrown ZeroTransferAmount error");
    } catch (err: any) {
      assert.include(err.toString(), "ZeroTransferAmount");
    }
  });
});