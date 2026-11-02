# 1. Build and verify the Anchor program
anchor build

# 2. Deploy to Solana Devnet / Mainnet
solana program deploy target/deploy/stealf_core.so \
  --program-id target/deploy/stealf_core-keypair.json \
  --url https://api.devnet.solana.com

# 3. Launch Dockerized Scanning Node
export RECEIVER_VIEW_PRIVKEY="c8f1...32bytesHex"
export RECEIVER_SPEND_PUBKEY="b1a4...32bytesHex"
export DISCORD_OR_SLACK_WEBHOOK="https://api.example.com/webhooks/alerts/placeholder"

docker-compose up -d --build

# 4. View scanning logs in real-time
docker-compose logs -f stealf-scanner