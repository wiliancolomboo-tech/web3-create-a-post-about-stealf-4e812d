# 1. Build Solana Anchor Program
anchor build

# 2. Deploy to Devnet / Mainnet
solana program deploy target/deploy/stealf.so \
  --program-id target/deploy/stealf-keypair.json \
  --url devnet

# 3. Initialize Global Registry
npm run cli initialize-registry

# 4. Run Off-Chain Test Suite
anchor test

# 5. Launch Enterprise Scanner in Docker
docker compose up -d --build
docker compose logs -f stealf-scanner