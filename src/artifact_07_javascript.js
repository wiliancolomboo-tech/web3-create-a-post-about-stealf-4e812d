const http = require("http");
const { StealfAgentDaemon } = require("./stealf_agent");

const PORT = process.env.PORT || 8080;
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const PROGRAM_ID = process.env.STEALF_PROGRAM_ID || "SteLfx4v5v7R9V2E3xN9K8QWzD1vG8yU6p4hJ2mZk8P";
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ALERT_EMAIL = process.env.ALERT_EMAIL;

const VIEW_KEY_HEX = process.env.RECIPIENT_VIEW_KEY_HEX;
const SPEND_PUB_HEX = process.env.RECIPIENT_SPEND_PUB_HEX;

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "healthy", timestamp: Date.now() }));
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`Stealf Healthcheck listener active on port ${PORT}`);

  if (VIEW_KEY_HEX && SPEND_PUB_HEX) {
    const daemon = new StealfAgentDaemon(
      RPC_URL,
      PROGRAM_ID,
      WEBHOOK_URL,
      RESEND_API_KEY,
      ALERT_EMAIL
    );
    daemon.startScanning(
      Buffer.from(VIEW_KEY_HEX, "hex"),
      Buffer.from(SPEND_PUB_HEX, "hex")
    );
  } else {
    console.warn("Keys not configured in environment. Daemon running in passive healthcheck mode.");
  }
});