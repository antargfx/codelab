# YouTube Lite — PWA Launcher

A tiny, installable "app" for phones whose browsers can't run the official
YouTube app. It shows a fast splash screen, then hands off straight into the
real youtube.com in full-screen (standalone) mode.

## Why it works without any login code
Google blocks youtube.com from being embedded in an iframe (via
`X-Frame-Options`/CSP), so it's not possible to truly "embed" the site inside
another page. Instead, this app does a normal full-page navigation to
youtube.com. Since it's the same Chrome browser and cookie storage, if you're
already signed into your Google account in Chrome, YouTube opens already
signed in — no extra code needed for that part.

## Files
- `index.html` — splash screen + redirect logic
- `manifest.json` — PWA manifest (name, icons, standalone display)
- `sw.js` — service worker (caches the shell, enables "Add to Home Screen")
- `icons/icon-192.png`, `icons/icon-512.png` — app icons

## Deploy on GitHub Pages
1. Create a new GitHub repo, e.g. `youtube-lite`.
2. Upload all files in this folder to the repo root (keep the `icons/` folder
   as a subfolder, don't flatten it).
3. Go to Settings → Pages → set source to your default branch (`main`) and
   root folder.
4. Wait a minute, then open `https://<your-username>.github.io/youtube-lite/`
   in Chrome on your phone.
5. Tap the browser menu → **Add to Home screen** (or Chrome may prompt you
   automatically after a visit or two). Once installed, opening it from the
   home screen launches full-screen with no address bar.

## Notes
- This must be served over HTTPS for the service worker/install prompt to
  work — GitHub Pages does this automatically.
- If you'd rather land on mobile search results or a specific channel instead
  of the homepage, change the `DEST` constant in `index.html`.
- This is a launcher, not a reimplementation of YouTube — video playback,
  search, comments, subscriptions etc. all come from the real site, so it
  stays extremely light (a few KB) and never goes out of date.
