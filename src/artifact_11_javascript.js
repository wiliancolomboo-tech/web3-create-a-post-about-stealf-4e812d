// Launch the interactive Anchor console
// $ anchor console --provider.cluster devnet

const { StealfEngine } = require("./sdk/stealf");
const meta = StealfEngine.generateMetaAddress();
console.log("Spend Pubkey:", Buffer.from(meta.spendPub).toString("hex"));
console.log("View Pubkey:", Buffer.from(meta.viewPub).toString("hex"));

// Derive stealth destination
const derivation = StealfEngine.deriveStealthDestination(meta.metaAddress);
console.log("Derived Stealth Public Key:", derivation.stealthPubkey.toBase58());
console.log("View Tag (Fast Scan):", derivation.viewTag);