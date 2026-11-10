## What does this change?

<!-- A short summary, and why it's needed. -->

Closes #

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Docs only
- [ ] Refactor / cleanup (no behavior change)
- [ ] Security hardening

## How did you test it?

<!-- There's no automated suite yet, so say what you ran and tried. -->

- [ ] `node --check` on the JS files I changed
- [ ] Played a direct file / HLS / DASH source in `/test.html` (list which): 
- [ ] Checked the player and, if relevant, the embed from a different origin
- [ ] Proxy changes: private targets (`127.0.0.1`, `169.254.169.254`) are still refused

Browser(s) and OS:

## Checklist

- [ ] The change is focused on one thing
- [ ] Docs updated (`README.md` and/or `public/docs.html`) if behavior changed
- [ ] No new runtime dependency (or I explained why it's needed)
- [ ] Commit messages follow Conventional Commits (`fix(player): ...`)
- [ ] If this touches `proxy.js`, the iframe fallback or `postMessage` handling, I explained the security reasoning above

## Screenshots / logs (optional)
