<div align="center">

<img src="./public/assets/logo-wordmark.svg" alt="UniplayOS" width="260">

### Universal media player engine

Video, audio, HLS, DASH, and embeds — through one resolver and proxy layer.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/express-4.x-000000?logo=express&logoColor=white)](https://expressjs.com)
[![hls.js](https://img.shields.io/badge/hls.js-1.5-e6491d)](https://github.com/video-dev/hls.js)
[![dash.js](https://img.shields.io/badge/dash.js-4.7-2c3e50)](https://github.com/Dash-Industry-Forum/dash.js)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)
[![Made with ❤](https://img.shields.io/badge/made%20with-%E2%9D%A4-red)](https://github.com/unitedevz)

**[Live Demo](https://www.uniplayos.web.id)** · **[Player](https://www.uniplayos.web.id/player.html)** · **[Test Console](https://www.uniplayos.web.id/test.html)**

</div>

---

## Features

- 🎬 **Universal resolver** — detects mp4/webm, HLS (`.m3u8`), DASH (`.mpd`), YouTube, and Vimeo from a raw URL and picks the right playback strategy
- 🔁 **Full manifest rewriting** — HLS and DASH segments, sub-playlists, and encryption keys are rewritten to route through the proxy, not just the top-level manifest
- 🛡️ **SSRF-guarded proxy** — blocks requests to private/internal IPs and cloud metadata endpoints, with DNS-rebind protection, an optional host allowlist, and per-IP rate limiting
- ⚡ **Manifest caching + auto-retry** — short-TTL in-memory cache for live manifests, one automatic retry on upstream 5xx/network errors
- ▶️ **Real embed control** — YouTube and Vimeo playback is driven through their official SDKs (IFrame API / Player SDK), so play/pause/seek/volume/speed all actually work, not just a static iframe
- ⏯️ **Continue watching** — resumes playback position per source URL via `localStorage`, with a subtle resume toast
- 🐢 **Playback speed control** — cycle 0.5x–2x, works across native video, YouTube, and Vimeo
- 📦 **Embeddable player** — drop `embed.js` into any page, zero build step
- 🧪 **Built-in test console** — live resolver output, proxy ping, and an event log for debugging playback

## Project Structure

```text
uniplayos/
├── index.js
├── proxy.js
├── embed.js
├── embed.esm.js
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
    └── js/
        └── utils/
            ├── utils.js
            ├── storage.js
            ├── api.js
            ├── resolver.js
            └── download.js
```

## Requirements

- Node.js 18+
- npm

## Setup

```bash
npm install
npm run dev
```

Server runs on `http://localhost:3000` by default.

## Configuration

All optional — copy `.env.example` to `.env` and adjust as needed:

| Variable                     | Default | Description                                                                 |
| ----------------------------- | ------- | ----------------------------------------------------------------------------- |
| `CF_WORKER_URL`               | unset   | Route proxy requests through a Cloudflare Worker first (for IP-range blocks) |
| `PROXY_RATE_LIMIT_MAX`        | `300`   | Max proxy requests per IP per window (HLS/DASH playback issues many requests) |
| `PROXY_RATE_LIMIT_WINDOW_MS`  | `60000` | Rate limit window, in milliseconds                                          |
| `PROXY_ALLOWED_HOSTS`         | unset   | Comma-separated host allowlist (e.g. `.example.com,cdn.example.org`). Leave empty to allow any public host |

The SSRF guard (blocking private IPs, localhost, and cloud metadata endpoints) is always on and isn't configurable.

## Testing

Go to `http://localhost:3000/test.html` — this is the dev testing page.

Paste any media URL into the input and hit Load. The panel shows:

- what the resolver detected (type, extension, whether it goes through the proxy)
- the resolved/proxy URL
- live playback state (buffering, stalled, errors, resolution, duration)
- a timestamped log of every event

**Proxy ping** — use the bottom input to test if a URL can be fetched through the proxy without loading it into the player.

### What works

- Direct video files (mp4, webm, etc.)
- HLS streams (.m3u8), including segment/key rewriting
- DASH streams (.mpd), including `BaseURL`/`SegmentList` rewriting
- YouTube and Vimeo, with full playback control via their official SDKs

### What doesn't

- TikTok, Instagram, Facebook — their video URLs are signed and loaded dynamically, can't be extracted without a headless browser or yt-dlp or something similar
- DASH `SegmentTemplate` streams using `$Number$`/`$Time$` placeholders — proxying these needs a path-based proxy scheme, not yet implemented

## Player

`http://localhost:3000/player.html` — the actual player. Accepts a `?url=` param so you can deep-link directly into it:

```
http://localhost:3000/player.html?url=https://example.com/video.mp4
```

Add `?debug=true` to show the URL input bar and status log inline.

## Embed

Drop this into any page to embed the player:

```html
<script src="http://localhost:3000/embed.js"></script>
```

## Proxy endpoint

`GET /proxy?url=<encoded-url>` — fetches and streams the target URL, with SSRF protection, rate limiting, HLS/DASH manifest rewriting, caching, and automatic retries.

Full docs: **[uniplayos.web.id/docs.html](https://www.uniplayos.web.id/docs.html)**

## Cloudflare Worker proxy (optional)

Some target sites block requests based on IP range. To bypass that, requests can be routed through a Cloudflare Worker that acts as an egress proxy — separate repo, `UniplayOsproxy`.

Set `CF_WORKER_URL` in `.env` (see `.env.example`) once deployed:

```
CF_WORKER_URL=https://uniplay-proxy.your-subdomain.workers.dev
```

Without this variable set, the app proxies directly as normal — this is purely an optional egress layer.

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

    UniplayOS.prototype.baseUrl = "https://www.uniplayos.web.id";

    const player = new UniplayOS({
      container: "#player",
      source: "https://eliteprotech-url.zone.id/1783881711744rbbva1.mp4",
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

PRs welcome. Fork the repo, branch off `main`, and open a pull request describing what changed and why.

## Lostboy Contribution

Redesign of `public/index.html` — landing page only, no logic touched.

- Rebuilt the layout with staggered entrance animations (`rise`, `underline`, `pulse` keyframes) instead of a static page, kept the exact same color tokens (`--bg`, `--accent`, `--muted`, etc.) so it still matches the player
- Swapped every icon for Font Awesome (`fa-play`, `fa-flask`, `fa-file-video`, `fa-tower-broadcast`, `fa-diagram-project`, `fa-code`) — no emoji anywhere
- Added a live status badge with a pulsing dot, a two-button hero (Launch Player / Try the Resolver), and a four-item capability grid (MP4/WebM, HLS, DASH, Embeddable)
- Full responsive pass: 4-column feature grid collapses to 2 columns under 768px, action buttons stack full-width under 420px
- Respects `prefers-reduced-motion` — animations and transitions drop out entirely for users who ask for it
- Added proper SEO/meta: `<meta name="description">`, `<meta name="keywords">`, canonical link, Open Graph and Twitter card tags, and a `SoftwareApplication` JSON-LD block so the page is actually indexable and shareable
- Added a subtle SVG-based noise texture and radial accent glows in the background for depth, all done in pure CSS, no extra image assets
- Footer now links out to the GitHub repo instead of dead-ending

## License

[MIT](./LICENSE)
