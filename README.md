# MBTA Commuter Rail

A real-time Progressive Web App for tracking MBTA Commuter Rail trains — built for daily commuters who want live departure times, track numbers, and service alerts without opening the full MBTA site.

**Live:** https://noahp.github.io/mbta-rail-pwa/

## Features

- **Favorite lines** — pinned to the top of the list
- **Favorite stops** — highlighted gold in the stop list; tap any stop to toggle
- **Live predictions** — departure times updated on a configurable interval (5s–1 min)
- **Track numbers** — shown when the MBTA assigns them (~30–60 min before departure at South/North Station)
- **Service alerts** — active alerts for your favorited routes, sorted by severity
- **Installable PWA** — works offline for cached data; add to home screen on iOS/Android

## Setup

No build step needed to run locally:

```bash
npm install
npm run dev
```

Open http://localhost:5173.

### API key

The MBTA API works without a key (20 req/min limit). For higher rate limits, get a free key at [api-v3.mbta.com](https://api-v3.mbta.com/) and paste it into the in-app settings.

## Build & deploy

```bash
npm run build   # outputs to dist/
npm run preview # preview the production build
```

Pushes to `main` automatically deploy to GitHub Pages via the included workflow.

## Tech

- Vanilla TypeScript, no framework
- [Vite](https://vitejs.dev/) + [vite-plugin-pwa](https://vite-pwa-org.netlify.app/)
- [MBTA API v3](https://api-v3.mbta.com/docs/swagger/index.html)
