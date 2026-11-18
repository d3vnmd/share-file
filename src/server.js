// Node.js entry point: adapts node:http to the web-standard handler in app.js.
import http from 'node:http';
import { Readable } from 'node:stream';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createStorage } from './storage/index.js';

let assets;
try {
  ({ assets } = await import('./assets.generated.js'));
} catch {
  console.error('Missing src/assets.generated.js. Run "npm run build" first (npm start does this for you).');
  process.exit(1);
}

if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile('.env');
  } catch {
    /* no .env file */
  }
}

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  console.error(`Configuration error: ${err.message}`);
  process.exit(1);
}

const app = createApp({ config, storage: createStorage(config), assets });
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection', 'te', 'trailer']);

function clientIp(req) {
  if (config.trustProxy) {
    const fwd = req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

const server = http.createServer(async (req, res) => {
  try {
    let origin;
    if (config.publicUrl) origin = config.publicUrl;
    else {
      const proto = config.trustProxy && req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      origin = `${proto}://${req.headers.host || 'localhost'}`;
    }
    let url;
    try {
      url = new URL(req.url, origin);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const headers = new Headers();
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const k = req.rawHeaders[i].toLowerCase();
      if (!HOP_BY_HOP.has(k) && k !== 'host') {
        try {
          headers.append(k, req.rawHeaders[i + 1]);
        } catch {
          /* skip invalid header */
        }
      }
    }
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const request = new Request(url, {
      method: req.method,
      headers,
      body: hasBody ? Readable.toWeb(req) : undefined,
      duplex: 'half',
    });
    const response = await app.fetch(request, {
      ip: clientIp(req),
      waitUntil: (p) => p.catch((e) => console.error('[background]', e)),
    });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (!response.body || req.method === 'HEAD') {
      res.end();
      return;
    }
    Readable.fromWeb(response.body).on('error', () => res.destroy()).pipe(res);
  } catch (err) {
    console.error('[server]', err);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal error');
  }
});

server.requestTimeout = 10 * 60 * 1000;

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
server.listen(port, host, () => {
  const where = config.storage === 'memory' ? 'memory (data is lost on restart!)' : `github:${config.githubRepo}@${config.githubBranch}`;
  console.log(`share-file listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}  storage=${where}`);
});

// Hourly cleanup of expired files.
const runCleanup = () =>
  app
    .cleanup()
    .then((n) => n && console.log(`[cleanup] removed ${n} expired objects`))
    .catch((e) => console.error('[cleanup]', e.message));
setTimeout(runCleanup, 15_000).unref();
setInterval(runCleanup, 60 * 60 * 1000).unref();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
