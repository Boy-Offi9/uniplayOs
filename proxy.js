import { pipeline } from 'stream';
import dns from 'dns';
import net from 'net';
import http from 'http';
import https from 'https';
import zlib from 'zlib';

function intFromEnv(name, fallback) {
  const parsed = parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const TIMEOUT_MS = 15000;
const CF_WORKER_URL = process.env.CF_WORKER_URL || null;
const MANIFEST_CACHE_TTL_MS = 4000;
const MANIFEST_CACHE_MAX_ENTRIES = 200;
const MAX_MANIFEST_BYTES = 5 * 1024 * 1024;
const MAX_URL_LENGTH = 8192;
const MAX_REDIRECTS = 5;
const SEGMENT_RETRY_COUNT = 1;
const SEGMENT_RETRY_DELAY_MS = 300;

const RATE_LIMIT_MAX = intFromEnv('PROXY_RATE_LIMIT_MAX', 300);
const RATE_LIMIT_WINDOW_MS = intFromEnv('PROXY_RATE_LIMIT_WINDOW_MS', 60000);
const RATE_LIMIT_MAX_TRACKED_IPS = 5000;

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PASSTHROUGH_HEADERS = ['content-type', 'content-length', 'content-range', 'content-encoding'];

const ALLOWED_HOSTS = (process.env.PROXY_ALLOWED_HOSTS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const manifestCache = new Map();
const rateLimitMap = new Map();

const blockedRanges = new net.BlockList();

[
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
].forEach(([address, prefix]) => blockedRanges.addSubnet(address, prefix, 'ipv4'));

[
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
].forEach(([address, prefix]) => blockedRanges.addSubnet(address, prefix, 'ipv6'));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function clientIp(req) {
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now >= entry.resetAt) {
    if (rateLimitMap.size >= RATE_LIMIT_MAX_TRACKED_IPS) {
      const oldestKey = rateLimitMap.keys().next().value;
      rateLimitMap.delete(oldestKey);
    }
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count, resetAt: entry.resetAt };
}

function normalizeHostname(hostname) {
  let host = hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  while (host.endsWith('.')) host = host.slice(0, -1);
  return host;
}

function isHostAllowlisted(hostname) {
  if (ALLOWED_HOSTS.length === 0) return true;
  return ALLOWED_HOSTS.some((pattern) => {
    if (pattern.startsWith('.')) return hostname === pattern.slice(1) || hostname.endsWith(pattern);
    return hostname === pattern;
  });
}

function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (family === 0) return true;
  return blockedRanges.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

function safeLookup(hostname, options, callback) {
  const lookupOptions = typeof options === 'number' ? { family: options } : { ...options };
  dns.lookup(hostname, { ...lookupOptions, all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err);
    if (addresses.some((entry) => isBlockedAddress(entry.address))) {
      return callback(httpError(403, 'target host not allowed'));
    }
    if (lookupOptions.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

async function assertSafeUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw httpError(400, 'invalid url');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw httpError(400, 'unsupported protocol');
  }

  if (parsed.username || parsed.password) {
    throw httpError(400, 'credentials in url not allowed');
  }

  const hostname = normalizeHostname(parsed.hostname);

  if (!hostname) {
    throw httpError(400, 'invalid url');
  }

  if (!isHostAllowlisted(hostname)) {
    throw httpError(403, 'host not allowed');
  }

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw httpError(403, 'target host not allowed');
  }

  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) throw httpError(403, 'target host not allowed');
    return;
  }

  let addresses;
  try {
    addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw httpError(400, 'could not resolve host');
  }

  if (addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw httpError(403, 'target host not allowed');
  }
}

function requestOnce(target, headers, signal) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(target);
    const transport = parsed.protocol === 'https:' ? https : http;
    const options = { method: 'GET', headers, signal };
    if (!CF_WORKER_URL) options.lookup = safeLookup;
    const request = transport.request(parsed, options, resolve);
    request.on('error', reject);
    request.end();
  });
}

function isAbortError(error) {
  return error.name === 'AbortError' || error.code === 'ABORT_ERR';
}

async function requestWithRetry(target, headers, signal) {
  let lastError;

  for (let attempt = 0; attempt <= SEGMENT_RETRY_COUNT; attempt++) {
    try {
      const response = await requestOnce(target, headers, signal);
      if (response.statusCode >= 500 && attempt < SEGMENT_RETRY_COUNT) {
        response.resume();
        await sleep(SEGMENT_RETRY_DELAY_MS);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (isAbortError(error) || error.statusCode || attempt === SEGMENT_RETRY_COUNT) throw error;
      await sleep(SEGMENT_RETRY_DELAY_MS);
    }
  }

  throw lastError;
}

async function fetchUpstream(startUrl, headers, signal) {
  let current = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertSafeUrl(current);

    const target = CF_WORKER_URL
      ? `${CF_WORKER_URL}?url=${encodeURIComponent(current)}`
      : current;

    const response = await requestWithRetry(target, headers, signal);
    const location = response.headers.location;

    if (response.statusCode >= 300 && response.statusCode < 400 && location) {
      response.resume();
      try {
        current = new URL(location, current).href;
      } catch {
        throw httpError(502, 'invalid redirect');
      }
      continue;
    }

    return { response, finalUrl: current };
  }

  throw httpError(502, 'too many redirects');
}

function readBody(response, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    response.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(httpError(502, 'manifest too large'));
        response.destroy();
        return;
      }
      chunks.push(chunk);
    });
    response.on('end', () => resolve(Buffer.concat(chunks)));
    response.on('error', reject);
    response.on('close', () => {
      if (!response.complete) reject(httpError(502, 'upstream closed early'));
    });
  });
}

function decodeBody(buffer, encoding) {
  const options = { maxOutputLength: MAX_MANIFEST_BYTES };
  switch ((encoding || '').toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return zlib.gunzipSync(buffer, options);
    case 'deflate':
      return zlib.inflateSync(buffer, options);
    case 'br':
      return zlib.brotliDecompressSync(buffer, options);
    default:
      return buffer;
  }
}

function manifestType(url, contentType) {
  const path = url.toLowerCase().split('?')[0];
  const type = contentType.toLowerCase();
  if (path.endsWith('.m3u8') ||
    type.includes('application/vnd.apple.mpegurl') ||
    type.includes('application/x-mpegurl') ||
    type.includes('audio/mpegurl')) {
    return 'hls';
  }
  if (path.endsWith('.mpd') || type.includes('application/dash+xml')) {
    return 'dash';
  }
  return null;
}

function makeProxifier(baseUrl, proxyBase) {
  return (raw) => {
    try {
      const absolute = new URL(raw, baseUrl);
      if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') return raw;
      return `${proxyBase}?url=${encodeURIComponent(absolute.href)}`;
    } catch {
      return raw;
    }
  };
}

function rewriteHlsManifest(manifest, manifestUrl, proxyBase) {
  const toProxied = makeProxifier(manifestUrl, proxyBase);

  return manifest
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();

      if (!trimmed) return line;

      if (trimmed.startsWith('#')) {
        return line.replace(/([:,])URI="([^"]*)"/g, (match, separator, uri) => {
          if (!uri) return match;
          return `${separator}URI="${toProxied(uri)}"`;
        });
      }

      return toProxied(trimmed);
    })
    .join('\n');
}

function rewriteDashManifest(manifest, manifestUrl, proxyBase) {
  const toProxied = makeProxifier(manifestUrl, proxyBase);

  let rewritten = manifest.replace(
    /<BaseURL>([^<]+)<\/BaseURL>/g,
    (_match, url) => `<BaseURL>${toProxied(url.trim())}</BaseURL>`
  );

  rewritten = rewritten.replace(
    /\b(media|initialization|sourceURL)="([^"]+)"/g,
    (match, attr, url) => {
      if (url.includes('$')) return match;
      return `${attr}="${toProxied(url)}"`;
    }
  );

  return rewritten;
}

function getCachedManifest(key) {
  const entry = manifestCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    manifestCache.delete(key);
    return null;
  }
  return entry;
}

function setCachedManifest(key, body, contentType) {
  if (manifestCache.size >= MANIFEST_CACHE_MAX_ENTRIES) {
    const oldestKey = manifestCache.keys().next().value;
    manifestCache.delete(oldestKey);
  }
  manifestCache.set(key, {
    body,
    contentType,
    expiresAt: Date.now() + MANIFEST_CACHE_TTL_MS,
  });
}

function applyHeaders(res, upstreamHeaders) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

  for (const name of PASSTHROUGH_HEADERS) {
    const value = upstreamHeaders[name];
    if (value) res.setHeader(name, value);
  }

  res.setHeader('Accept-Ranges', upstreamHeaders['accept-ranges'] || 'bytes');
}

function originOf(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}`;
  } catch {
    return '';
  }
}

export const proxyMedia = async (req, res) => {
  const url = req.query.url;

  if (typeof url !== 'string' || !url) {
    return res.status(400).json({ error: 'missing url' });
  }

  if (url.length > MAX_URL_LENGTH) {
    return res.status(414).json({ error: 'url too long' });
  }

  const ip = clientIp(req);
  const rateLimit = checkRateLimit(ip);

  res.setHeader('X-RateLimit-Limit', String(RATE_LIMIT_MAX));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, rateLimit.remaining)));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(rateLimit.resetAt / 1000)));

  if (!rateLimit.allowed) {
    res.setHeader('Retry-After', String(Math.ceil((rateLimit.resetAt - Date.now()) / 1000)));
    return res.status(429).json({ error: 'rate limit exceeded' });
  }

  try {
    await assertSafeUrl(url);
  } catch (error) {
    return res.status(error.statusCode || 400).json({ error: error.message });
  }

  const proxyBase = `${req.protocol}://${req.get('host')}/proxy`;
  const cacheKey = `${proxyBase}|${url}`;

  const cached = getCachedManifest(cacheKey);
  if (cached) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', cached.contentType);
    res.setHeader('X-Proxy-Cache', 'HIT');
    return res.status(200).send(cached.body);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  res.on('close', () => {
    clearTimeout(timeout);
    if (!res.writableFinished) controller.abort();
  });

  try {
    const headers = {
      'User-Agent': USER_AGENT,
      'Accept': '*/*',
      'Accept-Encoding': 'identity',
      'Referer': originOf(url),
    };

    if (req.headers.range) headers.Range = req.headers.range;

    const { response, finalUrl } = await fetchUpstream(url, headers, controller.signal);
    const contentType = response.headers['content-type'] || '';

    if (contentType.includes('text/html')) {
      response.resume();
      clearTimeout(timeout);
      return res.status(422).json({ error: 'url returned html, not a media file' });
    }

    const type = response.statusCode === 200
      ? (manifestType(url, contentType) || manifestType(finalUrl, contentType))
      : null;

    if (type) {
      const raw = await readBody(response, MAX_MANIFEST_BYTES);
      clearTimeout(timeout);

      const manifest = decodeBody(raw, response.headers['content-encoding']).toString('utf8');
      const rewritten = type === 'hls'
        ? rewriteHlsManifest(manifest, finalUrl, proxyBase)
        : rewriteDashManifest(manifest, finalUrl, proxyBase);
      const outContentType = type === 'hls'
        ? 'application/vnd.apple.mpegurl'
        : 'application/dash+xml';

      setCachedManifest(cacheKey, rewritten, outContentType);

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', outContentType);
      res.setHeader('X-Proxy-Cache', 'MISS');
      return res.status(200).send(rewritten);
    }

    clearTimeout(timeout);
    applyHeaders(res, response.headers);
    res.status(response.statusCode);

    pipeline(response, res, (err) => {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE' && !isAbortError(err)) {
        console.error('stream error', err.message);
      }
    });
  } catch (error) {
    clearTimeout(timeout);

    if (res.headersSent) {
      res.destroy();
      return;
    }

    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }

    if (isAbortError(error)) {
      return res.status(504).json({ error: 'upstream timeout' });
    }

    console.error('proxy error', error.message);
    return res.status(502).json({ error: 'upstream request failed' });
  }
};
