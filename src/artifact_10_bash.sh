# 1. Clone repository and install dependencies
git clone https://github.com/stealf-solana/stealf-protocol.git
cd stealf-protocol
yarn install

# 2. Build Anchor Smart Contracts
anchor build

# 3. Deploy to Solana Devnet / Mainnet
solana config set --url https://api.devnet.solana.com
anchor deploy --program-name stealf_core --program-keypair target/deploy/stealf_core-keypair.json

# 4. Run automated test suite with full assertions
anchor test

# 5. Launch Dockerized 24/7 Scanning Sentinel
docker-compose up -d --build
docker logs -f stealf-scanning-sentinel