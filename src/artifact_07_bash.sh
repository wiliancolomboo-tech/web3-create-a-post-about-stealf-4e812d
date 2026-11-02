# 1. Build optimized BPF program bytecode
anchor build

# 2. Deploy to Solana Devnet / Mainnet-Beta
solana program deploy \
  --program-id target/deploy/stealf_protocol-keypair.json \
  target/deploy/stealf_protocol.so \
  --url https://api.mainnet-beta.solana.com \
  --keypair ~/.config/solana/deployer-keypair.json

# 3. Initialize IDL on-chain
anchor idl init \
  --filepath target/idl/stealf_protocol.json \
  Stea1f1111111111111111111111111111111111111 \
  --provider.cluster mainnet