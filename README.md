<div align="center">

<img src="./public/assets/logo-wordmark.svg" alt="UniplayOS" width="260">

### Universal media player engine

Video, audio, HLS, DASH, and embeds — through one resolver and proxy layer.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/express-5.x-000000?logo=express&logoColor=white)](https://expressjs.com)
[![hls.js](https://img.shields.io/badge/hls.js-1.5-e6491d)](https://github.com/video-dev/hls.js)
[![dash.js](https://img.shields.io/badge/dash.js-4.7-2c3e50)](https://github.com/Dash-Industry-Forum/dash.js)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)
[![Made with ❤](https://img.shields.io/badge/made%20with-%E2%9D%A4-red)](https://github.com/unitedevz)

**[Live Demo](https://www.uniplayos.web.id)** · **[Player](https://www.uniplayos.web.id/player.html)** · **[Test Console](https://www.uniplayos.web.id/test.html)**

</div>

---

## Features

- 🎬 **Universal resolver**: detects mp4/webm, audio, HLS (`.m3u8`), DASH (`.mpd`), YouTube and Vimeo from a raw URL and picks the right playback strategy
- 🔁 **Full manifest rewriting**: HLS and DASH segments, sub-playlists, init segments and encryption keys are rewritten to route through the proxy, including DASH `SegmentTemplate` streams with `$Number$` / `$Time$` placeholders
- 🛡️ **SSRF-guarded proxy**: blocks private/internal IPs and cloud metadata endpoints, re-checks every redirect hop and the address at connect time (DNS-rebind safe), with an optional host allowlist and per-IP rate limiting
- ⚡ **Manifest caching + auto-retry**: short-TTL in-memory cache for live manifests, one automatic retry on upstream 5xx/network errors
- ▶️ **Real embed control**: YouTube and Vimeo are driven through their official SDKs, so play/pause/seek/volume/speed actually work, not just a static iframe
- 🎚️ **Quality, subtitles and playlists**: HLS/DASH quality menu, subtitle tracks (from the stream or external `.srt`/`.vtt` files), multi-item playlists with next/previous
- ⌨️ **Controls everywhere**: keyboard shortcuts, double-tap seek, picture-in-picture, playback speed, Media Session (lock-screen and headset keys)
- ⏯️ **Continue watching**: resumes playback position per source URL via `localStorage`, with a subtle resume toast
- ⬇️ **Downloads**: direct files and HLS/DASH streams (segments are fetched, decrypted if AES-128, and joined), saved straight to disk in Chromium browsers
- 📦 **Embeddable player**: drop `embed.js` into any page, zero build step
- 🧪 **Built-in test console**: live resolver output, proxy ping, and an event log for debugging playback

## Project Structure

```text
uniplayos/
├── index.js              # Express server (exports the app for Vercel)
├── proxy.js              # SSRF-guarded proxy, manifest rewriting, cache
├── embed.js              # drop-in embed script
├── embed.esm.js          # ES module wrapper around embed.js
├── package.json
├── .env.example
├── vercel.json
└── public/
    ├── index.html
    ├── player.html
    ├── test.html
    ├── downloads.html
    ├── settings.html
    ├── explorer.html
    ├── docs.html
    ├── assets/
    │   └── logo-wordmark.svg
    ├── css/
    │   └── enhance.css
    └── js/
        ├── utils/
        │   ├── utils.js
        │   ├── storage.js
        │   ├── api.js
        │   ├── resolver.js
        │   ├── download.js
        │   └── stream-download.js
        └── vendor/
            ├── reqkit.mjs          # vendored reqkit browser bundle
            └── reqkit-global.js    # exposes it as window.reqkit
```

## Requirements

- Node.js 18+
- npm

## Setup

```bash
npm install
npm run dev     # watch mode
npm start       # plain start, e.g. for production
```

Server runs on `http://localhost:3000` by default.

## Configuration

All optional. Copy `.env.example` to `.env` and adjust as needed:

| Variable                     | Default | Description                                                                                                |
| ---------------------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| `PORT`                       | `3000`  | Port the server listens on                                                                                 |
| `CF_WORKER_URL`              | unset   | Route proxy requests through a Cloudflare Worker first (for IP-range blocks)                               |
| `PROXY_RATE_LIMIT_MAX`       | `300`   | Max proxy requests per IP per window (HLS/DASH playback issues many requests)                              |
| `PROXY_RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window, in milliseconds                                                                         |
| `PROXY_ALLOWED_HOSTS`        | unset   | Comma-separated host allowlist (e.g. `.example.com,cdn.example.org`). Leave empty to allow any public host |

The SSRF guard (blocking private IPs, localhost, and cloud metadata endpoints) is always on and isn't configurable.

## Testing

Go to `http://localhost:3000/test.html`, the dev testing page.

Paste any media URL into the input and hit Load. The panel shows:

- what the resolver detected (type, extension, whether it goes through the proxy)
- the resolved/proxy URL
- live playback state (buffering, stalled, errors, resolution, duration)
- a timestamped log of every event

**Proxy ping**: use the bottom input to test whether a URL can be fetched through the proxy without loading it into the player. It only requests the first KB, so it's safe to point at large files.

### What works

- Direct video and audio files (mp4, webm, mp3, ...)
- HLS streams (`.m3u8`), including segment, key and init-segment rewriting
- DASH streams (`.mpd`), including `BaseURL`, `SegmentList` and `SegmentTemplate` (`$Number$` / `$Time$`) rewriting
- YouTube and Vimeo, with full playback control via their official SDKs
- Downloading direct files and non-live, non-DRM HLS/DASH streams

### What doesn't

- TikTok, Instagram, Facebook: their video URLs are signed and loaded dynamically, so they can't be extracted without a headless browser or yt-dlp or something similar
- DRM-protected streams and live streams (playback of live HLS works, downloading them doesn't)
- Downloading HLS encryption other than AES-128, and DASH streams with more than one period

## Player

`http://localhost:3000/player.html` is the actual player. Deep-link into it with query parameters:

```
http://localhost:3000/player.html?url=https://example.com/video.mp4&autoplay=true
```

| Parameter     | Description                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------- |
| `url` / `source` | Media URL to load                                                                         |
| `sources`     | JSON array of URLs (or `{ source, subtitles }` objects) for a playlist                       |
| `subtitles`   | JSON array of external subtitle files (`.srt` or `.vtt`) for the current source              |
| `autoplay`    | `true` to start playing on load                                                              |
| `theme`       | `dark` (default), `light` or `auto`                                                          |
| `downloads`   | `false` hides the download button                                                            |
| `debug`       | `true` shows the URL input bar and status log inline                                         |

Keyboard shortcuts (space/`k` play, arrows/`j`/`l` seek, `m` mute, `f` fullscreen, `c` captions, `<` `>` speed, `n`/`p` next/previous, ...) are listed in the [docs](https://www.uniplayos.web.id/docs.html#player).

## Embed

Drop this into any page to embed the player:

```html
<div id="uniplayos"></div>
<script src="http://localhost:3000/embed.js"></script>
<script>
  UniplayOS.init({ container: '#uniplayos', source: 'https://example.com/video.mp4' });
</script>
```

Or as an ES module:

```html
<script type="module">
  import UniplayOS from 'http://localhost:3000/embed.esm.js';
  const player = new UniplayOS({ container: '#uniplayos', source: 'https://example.com/video.mp4' });
</script>
```

The player iframe is loaded from the same origin that served the embed script, so this works on any host page. Pass `baseUrl` only if `player.html` lives somewhere else. Options, events (`onReady`, `onPlay`, `onError`, ...) and methods (`play()`, `seek()`, `setQuality()`, ...) are documented in the [docs](https://www.uniplayos.web.id/docs.html#embed-script).

## Deploying to Vercel

`index.js` exports the Express app, so Vercel runs it as a function. Keep in mind that every proxied byte flows through that function: Vercel limits function duration, and the in-memory rate limiter and manifest cache are per-instance. For heavy HLS/DASH traffic, a long-running Node host is the better fit.

## Proxy endpoint

`GET /proxy?url=<encoded-url>` fetches and streams the target URL, with SSRF protection, rate limiting, HLS/DASH manifest rewriting, caching, and automatic retries. Range requests are forwarded, so seeking works.

- Rate-limit state is sent back in `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`; a `429` carries `Retry-After`. The stream downloader reads these and slows itself down before it gets rejected.
- Manifest responses include `X-Proxy-Cache: HIT | MISS`.
- Every proxied response is sent with `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`, so a link to a hostile SVG or XML file can't run script on your origin.
- Upstream HTML is refused with `422`; upstream requests time out after 15 seconds.
- `GET /proxy/t/<token>/<rest>` serves DASH `SegmentTemplate` segments (see the docs).

Full docs: **[uniplayos.web.id/docs.html](https://www.uniplayos.web.id/docs.html)**

## Downloads

`/downloads.html` and the player's download button save direct files, and HLS/DASH streams by fetching and joining the segments in the browser. Chromium browsers write straight to disk, other browsers assemble the file in memory (up to 2 GB). Streams with separate video and audio are saved as two files. Segment requests are paced with [reqkit](https://github.com/boy-offi9-inc/reqkit)'s rate limiter (vendored in `public/js/vendor/`); if it fails to load, downloads still work.

## Security notes

- The proxy only fetches `http`/`https`, rejects URLs with embedded credentials, and blocks private, loopback, link-local and metadata addresses, on every redirect hop and again at connect time.
- Set `PROXY_ALLOWED_HOSTS` if you only need a known set of sources; it turns the proxy from "any public host" into an allowlist.
- The proxy is open to anyone who can reach it. If you expose it publicly, keep the rate limit on and consider putting it behind your own auth or an allowlist.
- The player only falls back to a plain iframe for `http`/`https` URLs. `javascript:` and `data:` URLs are never framed.

## Cloudflare Worker proxy (optional)

Some target sites block requests based on IP range. To bypass that, requests can be routed through a Cloudflare Worker that acts as an egress proxy, kept in a separate repo, `UniplayOsproxy`.

Set `CF_WORKER_URL` in `.env` (see `.env.example`) once deployed:

```
CF_WORKER_URL=https://uniplay-proxy.your-subdomain.workers.dev
```

Without this variable set, the app proxies directly as normal. This is purely an optional egress layer.

Deploy steps and details live in the [UniplayOsproxy](https://github.com/unitedevz/UniplayOsproxy) repo README.

## Embed Testing

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UniplayOS Test</title>
</head>
<body>

  <h2>UniplayOS Embed Test</h2>

  <div id="player" style="width:800px;height:450px;"></div>

  <script type="module">
    import UniplayOS from "https://www.uniplayos.web.id/embed.esm.js";

    const player = new UniplayOS({
      container: "#player",
      source: "https://example.com/video.mp4",
      debug: true,

      onReady() {
        console.log("Player Ready");
      },

      onPlay() {
        console.log("Playing");
      },

      onPause() {
        console.log("Paused");
      },

      onError(error) {
        console.log(error);
      }
    });

    window.player = player;
  </script>

</body>
</html>
```

## Contributing

PRs welcome. Fork the repo, branch off `main`, and open a pull request describing what changed and why. The full guide is in [CONTRIBUTING.md](./CONTRIBUTING.md): dev setup, how to test a change by hand, code style and commit conventions.

- **Found a bug or have an idea?** [Open an issue](https://github.com/unitedevz/uniplayOs/issues/new/choose); the forms ask for the details that make it quick to fix.
- **Found a security problem?** Please don't file a public issue. Follow [SECURITY.md](./SECURITY.md) and report it privately.


## License

[MIT](./LICENSE)
