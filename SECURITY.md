# Security Policy

UniplayOS runs a server-side proxy that fetches URLs on behalf of the browser, and a player that can be embedded on other sites, so security reports are taken seriously.

## Supported versions

Fixes land on the latest release on `main`. Older versions don't receive backports.

## Reporting a vulnerability

**Please don't open a public issue or pull request for a security problem.**

Use GitHub's private reporting instead: go to the repository's **Security** tab and choose **Report a vulnerability**
(<https://github.com/unitedevz/uniplayOs/security/advisories/new>).

Include:

- what the issue is and where it lives (file, route, parameter);
- steps to reproduce, or a proof of concept;
- the impact you expect (for example "reach an internal address" or "run script on the app origin");
- the version or commit you tested.

You can expect an acknowledgement within a few days. We'll keep you updated while we investigate, agree on a disclosure date with you, and credit you in the fix unless you'd rather stay anonymous.

## Scope

In scope:

- **SSRF or guard bypasses in the proxy** (`/proxy`, `/proxy/t/...`): reaching private, loopback, link-local or metadata addresses, DNS rebinding, redirect or IPv6/IPv4-mapped tricks, allowlist bypass.
- **Script execution on the app origin**: reflected or stored XSS through URL parameters, proxied content, subtitles or the iframe fallback.
- **Embed and `postMessage` flaws**: messages accepted from, or sent to, the wrong origin.
- **Resource exhaustion** that bypasses the existing limits (rate limit, manifest size cap, timeouts).

Out of scope:

- The proxy fetching **public** hosts. That's its job; use `PROXY_ALLOWED_HOSTS` to restrict it.
- Rate limiting being per-instance on serverless platforms (documented behavior).
- Findings that need a modified browser, local access to the user's machine, or already-malicious browser extensions.
- Missing hardening headers with no demonstrated impact.
- Third-party services (YouTube, Vimeo, upstream media hosts) and vendored libraries; report those upstream (but do tell us if our *use* of them is unsafe).

## Hardening your deployment

- Keep the rate limit on, and set `PROXY_ALLOWED_HOSTS` if you only need known sources.
- If the proxy is public, consider putting it behind your own authentication.
- Keep Node.js and your dependencies up to date (Dependabot is enabled in this repo).
