# 1. Build optimized on-chain BPF artifact
anchor build

# 2. Deploy to Solana Devnet or Mainnet-Beta
solana config set --url https://api.mainnet-beta.solana.com
solana program deploy target/deploy/stealf_core.so --program-id target/deploy/stealf_core-keypair.json

# 3. Initialize & Start the Real-Time Scanning Daemon
npm install
npm run build
npm run start:daemon