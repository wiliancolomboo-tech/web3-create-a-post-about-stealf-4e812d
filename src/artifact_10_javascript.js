// Start Anchor interactive client
// anchor console --provider.cluster devnet

const idl = JSON.parse(fs.readFileSync("./target/idl/stealf.json", "utf8"));
const program = new anchor.Program(idl, new PublicKey("YOUR_PROGRAM_ID"), provider);

// Inspect any Stealth Vault on-chain
const [vault] = PublicKey.findProgramAddressSync(
  [Buffer.from("stealth_vault"), targetStealthPubkey.toBuffer()],
  program.programId
);
const accountData = await program.account.stealthVault.fetch(vault);
console.log("Stealth Vault Balance:", accountData.amount.toString());
console.log("Is Claimed:", accountData.isClaimed);