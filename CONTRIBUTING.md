# Contributing to UniplayOS

Thanks for helping out. This guide covers how to run the project, what a good change looks like, and how to get it merged.

## Before you start

- **Bugs and ideas:** open an [issue](https://github.com/unitedevz/uniplayOs/issues/new/choose) first for anything bigger than a small fix, so we can agree on the approach before you spend time on it.
- **Security problems:** do **not** open a public issue. See [SECURITY.md](./SECURITY.md).
- **Small fixes** (typos, docs, an obvious bug) can go straight to a pull request.

## Development setup

You need Node.js 18+ and npm.

```bash
git clone https://github.com/<your-fork>/uniplayOs.git
cd uniplayOs
npm install
cp .env.example .env   # optional, every variable has a default
npm run dev            # http://localhost:3000, restarts on change
```

There is no build step. The server is plain ES modules (`index.js`, `proxy.js`) and the frontend is static files in `public/` that load classic `<script>` tags.

## Project layout

| Path | What lives there |
| ---- | ---------------- |
| `index.js` | Express server, static files, `/proxy` routes |
| `proxy.js` | SSRF guard, upstream fetching, HLS/DASH manifest rewriting, cache, rate limit |
| `embed.js`, `embed.esm.js` | The drop-in embed script and its ES module wrapper |
| `public/player.html` | The player (UI, playback strategies, `postMessage` API) |
| `public/test.html` | Dev console: resolver output, proxy ping, event log |
| `public/js/utils/` | Resolver, downloader, stream downloader, storage and helpers |
| `public/js/vendor/` | Vendored third-party bundles (currently [reqkit](https://github.com/boy-offi9-inc/reqkit)) |
| `public/docs.html` | The documentation site |

## Testing your change

There is no automated test suite yet, so please verify by hand and say what you did in the pull request.

1. **Syntax check** the files you touched:
   ```bash
   node --check index.js && node --check proxy.js
   node --check public/js/utils/stream-download.js   # and any other JS you changed
   ```
2. **Play something** in `http://localhost:3000/test.html`. Cover the source types your change could affect: a direct `mp4`, an HLS `.m3u8`, a DASH `.mpd`, and YouTube or Vimeo if you touched the embed code.
3. **Proxy changes:** use the *proxy ping* box in the test console, and confirm that private targets such as `http://127.0.0.1/` and `http://169.254.169.254/` are still refused.
4. **Player or embed changes:** load `public/player.html?url=...` directly *and* through `embed.js` from a page on a different origin, since the two paths behave differently.
5. **Download changes:** try one direct file and one HLS or DASH stream from `/downloads.html`.

If you add logic that can be tested without a browser (manifest rewriting, URL parsing, the SSRF guard), consider adding a test with Node's built-in runner (`node --test`). It would be the start of a proper suite, and it is very welcome.

## Code style

- Keep it dependency-light. Adding a runtime dependency needs a good reason; prefer a small, readable helper.
- Match the surrounding code: ES modules on the server, and classic scripts that expose global classes (`Utils`, `Resolver`, ...) in `public/js/utils/`.
- Prefer clear names and early returns over comments that restate the code. Comment the *why* when something looks odd (a workaround, a browser quirk, a security reason).
- Use the `Storage` helper for new `localStorage` access (it never throws when storage is blocked), and avoid new globals beyond the existing `window.X = X` exports.
- UI text and docs: short sentences, plain words.

### Security-sensitive areas

Changes to `proxy.js`, the iframe fallback in `player.html`, or `embed.js` message handling get extra review. Please:

- never weaken the SSRF guard, even behind a flag;
- never frame or navigate to a URL that isn't `http`/`https`;
- check `event.origin` / `event.source` on any new `postMessage` handler;
- explain the security reasoning in the pull request.

## Commits and pull requests

1. Fork the repo and branch off `main` (`fix/dash-error-handling`, `feat/subtitle-menu`, ...).
2. Keep each pull request focused on one thing. Unrelated cleanups belong in their own PR.
3. Write commit messages in the [Conventional Commits](https://www.conventionalcommits.org/) style we use throughout the history:
   ```text
   fix(player): stop the spinner sticking after a seek
   feat(downloader): pace segment requests with a rate limiter
   docs: refresh README and proxy docs
   chore: bump vendored reqkit
   ```
   Common types: `fix`, `feat`, `docs`, `chore`, `refactor`, `perf`, `test`. The scope in brackets is optional.
4. Update the docs when behavior changes: `README.md` for setup and overview, `public/docs.html` for options, params and API.
5. Open the pull request and fill in the template. Link the issue it closes (`Closes #123`).
6. Be ready for review feedback. Push follow-up commits to the same branch; the maintainers may squash on merge.

## Reporting bugs

Use the **Bug report** form. The most useful reports include:

- the source type (mp4, HLS, DASH, YouTube, Vimeo) and, if it's public, the URL;
- where it happens (player, embed, test console, downloads, proxy);
- your browser and OS;
- what you expected, what happened, and any console or test-console log output.

**Don't paste private, signed or tokenized URLs** in a public issue. Strip the query string, or use a public sample stream that reproduces the problem.

## Requesting features

Use the **Feature request** form and describe the problem first, then the change you have in mind. Features that need site-specific extraction (TikTok, Instagram, Facebook) are out of scope; see the README for why.

## License

By contributing you agree that your contributions are licensed under the [MIT License](./LICENSE).
