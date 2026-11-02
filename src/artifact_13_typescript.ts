import http from 'http';

const PORT = process.env.PORT || 8080;
let isHealthy = true;
let lastSlotProcessed = 0;

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    if (isHealthy) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', lastSlotProcessed, uptime: process.uptime() }));
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'unhealthy', lastSlotProcessed }));
    }
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`Stealf daemon listening on port ${PORT}`);
});