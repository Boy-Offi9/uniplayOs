// Lightweight self-test for the server pieces that are easy to regress:
// the rate limiter's LRU eviction and window reset, the URL guards, and the
// SRT -> WebVTT conversion. Run with `npm test` (node:test, no dependencies).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from '../rate-limit.js';
import { Utils } from '../public/js/utils/utils.js';

test('rate limiter: blocks after max within window', () => {
  const limiter = createRateLimiter({ max: 2, windowMs: 1000 });
  assert.equal(limiter.check('a').allowed, true);
  assert.equal(limiter.check('a').allowed, true);
  const third = limiter.check('a');
  assert.equal(third.allowed, false);
  assert.equal(third.remaining, 0);
});

test('rate limiter: resets after the window', async () => {
  const limiter = createRateLimiter({ max: 1, windowMs: 30 });
  assert.equal(limiter.check('a').allowed, true);
  assert.equal(limiter.check('a').allowed, false);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(limiter.check('a').allowed, true, 'window expired -> fresh budget');
});

test('rate limiter: eviction drops least-recently used, not oldest inserted', () => {
  const limiter = createRateLimiter({ max: 5, windowMs: 60000, maxTrackedKeys: 2 });
  limiter.check('first'); // oldest insert
  limiter.check('second');
  limiter.check('first'); // touch: now "second" is least recently used
  limiter.check('third'); // full -> evict, must not evict "first"
  // "first" keeps counting within its window (still tracked, not reset):
  const first = limiter.check('first');
  assert.ok(first.remaining <= 4, 'first should retain its window state');
  // "second" was the LRU entry and got evicted:
  const second = limiter.check('second');
  assert.equal(second.remaining, 4, 'second should have been evicted (fresh window)');
});

test('utils.safeMediaUrl: blocks javascript:, file:, and svg data URLs', () => {
  assert.equal(Utils.safeMediaUrl('javascript:alert(1)'), '');
  assert.equal(Utils.safeMediaUrl('file:///etc/passwd'), '');
  assert.equal(Utils.safeMediaUrl('data:image/svg+xml,<svg onload=alert(1)>'), '');
  assert.equal(Utils.safeMediaUrl('data:video/mp4;base64,AAAA'), 'data:video/mp4;base64,AAAA');
  assert.equal(Utils.safeMediaUrl('https://cdn.example.com/v.mp4'), 'https://cdn.example.com/v.mp4');
  assert.equal(Utils.safeMediaUrl('/proxy?url=x'), '/proxy?url=x');
  assert.equal(Utils.safeMediaUrl('//evil.example.com/x'), '');
});

test('utils.toWebVtt: converts SRT timing commas', () => {
  const srt = '1\n00:00:01,000 --> 00:00:03,000\nHello\n';
  const vtt = Utils.toWebVtt(srt);
  assert.ok(vtt.startsWith('WEBVTT'));
  assert.ok(vtt.includes('00:00:01.000 --> 00:00:03.000'));
});
