# 1. Build smart contract binary
anchor build

# 2. Deploy to Solana Devnet / Mainnet
solana config set --url https://api.devnet.solana.com
solana airdrop 2
anchor deploy --program-name stealf_protocol

# 3. Build & link client CLI
cd client
npm install
npm run build
npm link