# Lite Tube

A tiny, installable PWA that browses & watches YouTube videos — built for phones too old to run the official YouTube app.

- **~20KB app shell**, no frameworks, no build step.
- Browses/searches videos via the public **Piped API** (no Google API key or quota needed).
- Plays video through YouTube's own official `youtube-nocookie.com` embedded player — playback always happens on YouTube's servers, this app just gives you a lighter way to browse and launch it.
- Installable to the home screen like a real app (manifest + service worker cache the app shell for instant loads; video data itself is always fetched fresh, never cached).

## Files

| File | Purpose |
|---|---|
| `index.html` | The entire app — HTML, CSS and JS in one file |
| `manifest.json` | Makes the site installable as a PWA |
| `sw.js` | Service worker — caches only the static shell, not video data |
| `icon.svg`, `icon-192.png`, `icon-512.png`, `icon-192-maskable.png`, `icon-512-maskable.png` | App icons |

## Deploy on GitHub Pages

1. Create a new GitHub repo (e.g. `lite-tube`).
2. Upload **all files in this folder**, keeping them at the repo root (don't nest them in a subfolder).
3. Go to your repo → **Settings → Pages** → under "Build and deployment", set **Source: Deploy from a branch**, branch **main**, folder **/(root)**.
4. Wait ~1 minute, then visit `https://<your-username>.github.io/<repo-name>/`.
5. Open that link on your old phone's browser → menu → **"Add to Home Screen"** (or use the in-app "Install app" button in Settings ⚙️, on browsers that support it).

That's it — no server, no backend, no API keys to manage.

## If videos stop loading

Piped is a network of independent, community-run public API instances, and any single one can go down or get rate-limited. If you see a loading error:

1. Tap **⚙️ Settings** (top right).
2. Pick a different instance from the dropdown, or paste in another public instance URL.
3. Tap **Save**.

Your choice is remembered on that device (stored in `localStorage`), so you only need to do this once unless that instance also goes down.

You can find an up-to-date list of public Piped instances at: https://piped-instances.kavin.rocks

## Notes & limits

- This is a **browsing/search + launch** client, not a full re-implementation of YouTube — no comments, no account/subscriptions sync, no likes. It's intentionally minimal to stay fast and light.
- Because playback uses YouTube's real embedded player, ads may still appear during video playback (that's YouTube's player, not this app).
- Everything runs client-side; nothing is sent to any server other than the Piped instance (for search/listings) and YouTube (for playback).
