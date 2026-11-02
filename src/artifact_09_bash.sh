# 1. Clone repository & install dependencies
git clone https://github.com/stealf-protocol/stealf-core.git
cd stealf-core
npm install

# 2. Execute unit and cryptographic test suite
npm run test

# 3. Build Anchor program (for on-chain registry)
anchor build
anchor deploy --provider.cluster devnet

# 4. Generate master enterprise Stealf keys
npx ts-node client/cli.ts keygen --output ./stealf-keys.json

# 5. Launch Dockerized background detection agent
docker compose up -d --build

# 6. Verify operational health & telemetry
docker logs -f stealf-scanning-daemon