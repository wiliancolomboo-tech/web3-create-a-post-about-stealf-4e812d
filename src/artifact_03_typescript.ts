import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Stealf } from "../target/types/stealf";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import * as crypto from "crypto";

describe("stealf protocol functional verification", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Stealf as Program<Stealf>;

  const sender = Keypair.generate();
  const recipient = Keypair.generate();
  
  // Ephemeral stealth keypair
  const ephemeralKeypair = Keypair.generate();
  const stealthWallet = Keypair.generate(); // Emulates the one-time derived stealth address
  const destination = Keypair.generate();

  let registryPda: PublicKey;
  let announcementPda: PublicKey;
  let vaultPda: PublicKey;

  before(async () => {
    // Fund sender, recipient, and stealthWallet for rent/signatures
    const airdropSig1 = await provider.connection.requestAirdrop(sender.publicKey, 5 * LAMPORTS_PER_SOL);
    const airdropSig2 = await provider.connection.requestAirdrop(recipient.publicKey, 2 * LAMPORTS_PER_SOL);
    const airdropSig3 = await provider.connection.requestAirdrop(stealthWallet.publicKey, 0.5 * LAMPORTS_PER_SOL);

    const latestBlockHash = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({
      blockhash: latestBlockHash.blockhash,
      lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      signature: airdropSig1,
    });
    await provider.connection.confirmTransaction({
      blockhash: latestBlockHash.blockhash,
      lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      signature: airdropSig2,
    });
    await provider.connection.confirmTransaction({
      blockhash: latestBlockHash.blockhash,
      lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      signature: airdropSig3,
    });

    [registryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("registry"), recipient.publicKey.toBuffer()],
      program.programId
    );

    [announcementPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("announcement"), stealthWallet.publicKey.toBuffer()],
      program.programId
    );

    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), stealthWallet.publicKey.toBuffer()],
      program.programId
    );
  });

  it("Registers recipient spending and viewing keys", async () => {
    const spendingKey = crypto.randomBytes(32);
    const viewingKey = crypto.randomBytes(32);

    await program.methods
      .registerKeys(Array.from(spendingKey), Array.from(viewingKey))
      .accounts({
        registry: registryPda,
        owner: recipient.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([recipient])
      .rpc();

    const regAccount = await program.account.userRegistry.fetch(registryPda);
    expect(regAccount.owner.toBase58()).to.equal(recipient.publicKey.toBase58());
    expect(Buffer.from(regAccount.spendingPubkey)).to.deep.equal(spendingKey);
  });

  it("Executes stealth SOL transfer to vault and emits announcement", async () => {
    const transferAmount = new anchor.BN(1.5 * LAMPORTS_PER_SOL);
    const ephemeralBytes = Array.from(ephemeralKeypair.publicKey.toBytes());

    await program.methods
      .transferStealthSol(stealthWallet.publicKey, ephemeralBytes, transferAmount)
      .accounts({
        announcement: announcementPda,
        vault: vaultPda,
        sender: sender.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([sender])
      .rpc();

    const vaultBalance = await provider.connection.getBalance(vaultPda);
    expect(vaultBalance).to.equal(1.5 * LAMPORTS_PER_SOL);

    const announcementState = await program.account.announcement.fetch(announcementPda);
    expect(announcementState.stealthAddress.toBase58()).to.equal(stealthWallet.publicKey.toBase58());
    expect(announcementState.amount.toNumber()).to.equal(1.5 * LAMPORTS_PER_SOL);
    expect(announcementState.claimed).to.be.false;
  });

  it("Rejects unauthenticated or mismatched claim attempts", async () => {
    const rogueSigner = Keypair.generate();
    try {
      await program.methods
        .claimStealthSol()
        .accounts({
          announcement: announcementPda,
          vault: vaultPda,
          stealthSigner: rogueSigner.publicKey,
          destination: rogueSigner.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([rogueSigner])
        .rpc();
      expect.fail("Transaction should have failed due to unauthorized signer");
    } catch (err: any) {
      expect(err.toString()).to.include("ConstraintSeeds");
    }
  });

  it("Successfully claims stealth funds and reclaims rent", async () => {
    const destInitialBalance = await provider.connection.getBalance(destination.publicKey);

    await program.methods
      .claimStealthSol()
      .accounts({
        announcement: announcementPda,
        vault: vaultPda,
        stealthSigner: stealthWallet.publicKey,
        destination: destination.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([stealthWallet])
      .rpc();

    const destFinalBalance = await provider.connection.getBalance(destination.publicKey);
    expect(destFinalBalance).to.be.greaterThan(destInitialBalance + 1.49 * LAMPORTS_PER_SOL);

    const vaultBalance = await provider.connection.getBalance(vaultPda);
    expect(vaultBalance).to.equal(0);

    // Verify announcement account was closed
    const closedAccount = await provider.connection.getAccountInfo(announcementPda);
    expect(closedAccount).to.be.null;
  });
});