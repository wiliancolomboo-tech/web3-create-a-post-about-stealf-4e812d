# 1. Build and verify the on-chain Anchor program
anchor build
anchor verify Stea1f1111111111111111111111111111111111111

# 2. Deploy program to Solana Mainnet-Beta
solana program deploy \
  --program-id target/deploy/stealf_core-keypair.json \
  target/deploy/stealf_core.so \
  --url-override https://api.mainnet-beta.solana.com

# 3. Spin up self-hosted autonomous scanner container
docker-compose up -d --build