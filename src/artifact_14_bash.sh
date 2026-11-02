# Execute stealth transfer using recipient's meta keys
node dist/cli.js send \
  --spend-pub <RECIPIENT_SPEND_HEX> \
  --view-pub <RECIPIENT_VIEW_HEX> \
  --amount 0.25 \
  --payer ~/.config/solana/id.json \
  --rpc https://api.devnet.solana.com