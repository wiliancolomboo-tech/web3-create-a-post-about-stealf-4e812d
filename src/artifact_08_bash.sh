# 1. Clone & Setup Workspace
git clone https://github.com/stealf-protocol/stealf-solana.git
cd stealf-solana

# 2. Build Anchor Smart Contracts
anchor build

# 3. Deploy to Solana Devnet
solana config set --url devnet
solana airdrop 2
anchor deploy --program-name stealf_core

# 4. Initialize Scanner & Relayer Client
cd client
npm install
npm run build

# 5. Launch with Docker Compose
docker compose up -d --build
docker compose logs -f