import 'dotenv/config';
import express from 'express';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { proxyMedia, proxyTemplatedMedia } from './proxy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(cors());
app.use(express.static(publicDir));

app.get('/embed.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'embed.js'));
});

app.get('/embed.esm.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'embed.esm.js'));
});

const proxyPreflight = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
  res.sendStatus(204);
};

const guardProxy = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    console.error('Proxy error:', err.message);
    if (res.headersSent) return res.destroy();
    res.status(502).json({ error: 'Failed to fetch media' });
  }
};

app.options('/proxy', proxyPreflight);
app.options('/proxy/t/*', proxyPreflight);
app.get('/proxy', guardProxy(proxyMedia));
app.get('/proxy/t/*', guardProxy(proxyTemplatedMedia));

app.get('*', (req, res) => {
  if (path.extname(req.path)) {
    return res.status(404).type('text/plain').send('Not found');
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`UniplayOS running on http://localhost:${PORT}`);
});
