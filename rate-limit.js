// Small fixed-window, per-IP rate limiter with no dependencies. The proxy and the
// site-wide middleware both use it so the behaviour (and the response headers)
// stay identical everywhere.

export function intFromEnv(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function createRateLimiter({ max, windowMs, maxTrackedKeys = 5000 }) {
  const hits = new Map();

  // Returns { allowed, remaining, resetAt } and counts the hit when allowed.
  function check(key) {
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || now >= entry.resetAt) {
      if (hits.size >= maxTrackedKeys) {
        const oldestKey = hits.keys().next().value;
        hits.delete(oldestKey);
      }
      const resetAt = now + windowMs;
      hits.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: max - 1, resetAt };
    }

    if (entry.count >= max) {
      return { allowed: false, remaining: 0, resetAt: entry.resetAt };
    }

    entry.count += 1;
    return { allowed: true, remaining: max - entry.count, resetAt: entry.resetAt };
  }

  function setHeaders(res, state) {
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, state.remaining)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(state.resetAt / 1000)));
    if (!state.allowed) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((state.resetAt - Date.now()) / 1000))));
    }
  }

  // Express middleware. `skip(req)` lets a route opt out (the proxy has its own budget).
  function middleware({ skip } = {}) {
    return (req, res, next) => {
      if (skip && skip(req)) return next();
      const state = check(clientIp(req));
      setHeaders(res, state);
      if (!state.allowed) return res.status(429).type('text/plain').send('Too many requests');
      return next();
    };
  }

  return { check, setHeaders, middleware };
}
