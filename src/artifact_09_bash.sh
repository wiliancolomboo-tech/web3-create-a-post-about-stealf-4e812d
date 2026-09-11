# Set network to devnet
solana config set --url https://api.devnet.solana.com

# Airdrop deployment fees
solana airdrop 2

# Deploy program
anchor deploy --provider.cluster devnet