# 1. Build and test on localnet
anchor test

# 2. Deploy Anchor Program to Solana Devnet / Mainnet
solana config set --url https://api.devnet.solana.com
solana airdrop 2
anchor build
anchor deploy --program-name stealf_core --provider.cluster Devnet

# 3. Environment Configuration
cat <<EOF > .env
SOLANA_RPC_URL=https://api.devnet.solana.com
STEALF_PROGRAM_ID=$(solana address -k target/deploy/stealf_core-keypair.json)
DISCORD_WEBHOOK_URL=https://api.example.com/webhooks/alerts/placeholder
PRIVATE_VIEW_KEY=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
SPEND_PUBLIC_KEY=f1b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b811
EOF

# 4. Launch Containerized Scanner Service
docker compose up -d --build

# 5. Inspect Service Health
curl -f http://localhost:8080/health || echo "Daemon initializing..."
docker logs -f stealf_production_scanner