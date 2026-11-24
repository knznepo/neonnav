# NeonNav

Game-style radar map and navigation app. One web codebase that runs:

- in any browser (and installs as a PWA from the browser menu)
- as a native **Android** app (Capacitor)
- as a native **iOS** app (Capacitor)

Everything it uses is free and needs no API key:

| What | Service |
|---|---|
| Map rendering | MapLibre GL JS |
| Map tiles | OpenFreeMap (OpenStreetMap data) |
| Search / reverse geocoding | Photon (komoot) |
| Driving routes | OSRM public demo server |

## Run in the browser

```bash
npm install
npm run dev          # http://localhost:5173 (also on your LAN IP for phones)
```

Browsers only share GPS location on `https://` or `localhost`. To test on a phone on the same Wi-Fi:

```bash
npm run dev:https    # https://<your-computer-ip>:5173, accept the certificate warning once
```

### How location works

1. On launch it asks for location permission, gets a quick rough fix, then switches to precise GPS.
2. Your last position is saved on the device, so the next launch opens right where you were.
3. If location is blocked, switched off, or slow, it shows your approximate area (last saved
   position, else a city-level guess from your IP address via geojs.io) and says why.
   Tap the arrow button to try again.

## Deploy as a website / PWA (free)

```bash
npm run build        # outputs dist/
```

Upload `dist/` to any static host (Netlify, Vercel, Cloudflare Pages, GitHub Pages).
On the phone, open the site, then **Add to Home Screen** (iOS Safari) or **Install app** (Android Chrome).

## Web version

Live at **https://knznepo.github.io/neonnav/** (redeployed automatically on every push to `main`).
On a phone, open it and use *Add to Home Screen* (iPhone Safari) or *Install app* (Android Chrome).

## Download builds (no tools needed)

GitHub builds both apps on every push (`.github/workflows/build.yml`):

- **Releases** (https://github.com/knznepo/neonnav/releases): direct downloads of the
  Android `.apk` and iOS `.ipa` for each version tag (`git tag v1.0.1 && git push --tags`).
- **Actions** tab: the latest build's files for every push (sign in to GitHub to download).

Install the `.ipa` on an iPhone with [Sideloadly](https://sideloadly.io) or
[AltStore](https://altstore.io) and your Apple ID (free accounts: re-sign every 7 days).

Android updates install over the previous version only when the `ANDROID_KEYSTORE_B64` and
`ANDROID_KEYSTORE_PASSWORD` repository secrets are set (see `keystore/`, kept out of git;
back it up). Without them, builds use a throwaway key and need an uninstall before updating.

## Android

Requires [Android Studio](https://developer.android.com/studio).

```bash
npm run android      # builds web, syncs, opens Android Studio
```

In Android Studio press **Run** for a phone/emulator, or **Build > Generate Signed App Bundle** for the Play Store.

## iOS

Requires Xcode (and an Apple Developer account to install on a real device / publish).

```bash
npm run ios          # builds web, syncs, opens Xcode
```

Pick your Team under **Signing & Capabilities**, choose a device, and press Run.

After any web code change: `npm run sync` (or the android/ios scripts) to copy it into the native apps.

## Using the app

- **Drive view**: 3D map that follows you heading-up, round radar minimap, street name, and speed.
- **Map button**: full top-down map with a legend. Tap anywhere to set a waypoint.
- **Long-press** (or right-click) anywhere to set a waypoint from either view.
- **Search** bar finds places near you.
- **Start** begins turn-by-turn guidance (auto-reroutes if you go off route).
- **Demo drive** simulates driving the route, which is handy for testing at a desk.

### Navigation extras

- **Voice guidance**: spoken turn prompts (early warning, closer reminder, "now"), reroute and
  arrival announcements. Toggle with the speaker button while navigating. Native apps use the
  system text-to-speech engine; browsers use the Web Speech API.
- **Speed limit sign**: from OpenStreetMap via the free Valhalla service (FOSSGIS); the speed box
  turns red when you're over. Hidden on roads without a mapped limit.
- **Quick find rail** (left edge): nearest gas, food, shops, ATMs, parking, pharmacies and hotels,
  combining loaded map pins, OpenStreetMap search and Foursquare.
- **Saved places**: save any place as Home, Work or a favorite from its card (bookmark button).
  They get their own pins and appear in the empty search box with your recent searches.
  Stored on the device only.

### Exploration fog and minimap

- **Fog over unexplored areas**: a dark translucent overlay covers places you haven't been. Your
  current town or city (its OpenStreetMap boundary, via Nominatim) is revealed when the app
  starts, plus a ~450 m corridor around everywhere you actually go (real GPS only). Progress is
  saved on the device. Turn it on or off in ⚙ Settings (map view).
- **Gap filling**: if tracking pauses (browser hidden, screen locked, no signal) and you reappear
  somewhere else, the likely road between the two points is revealed (gaps under 30 km).
- **Background exploration (native apps only)**: the **Background** button in map view keeps GPS
  running without a destination (Android shows a notification; iOS shows the location
  indicator). Uses more battery. Browsers can't track location in the background at all, so
  on the web keep the app open on screen while driving.
- **Minimap toggle**: the minimap button (drive view) shows or hides the minimap; remembered.

### RFID toll balances (Easytrip, Autosweep)

Neither provider has a public API, so balances are entered manually and kept up to date by the app:

- Balances show in the top-right corner (tap to manage: set exact amount, quick reloads, history).
- While you drive, the app checks every ~15 s whether you're on a toll road (OpenStreetMap data via
  Valhalla). When you leave one, it deducts the toll for that entry→exit trip.
- The first time on a trip it asks for the amount once (from your receipt or the provider's SMS)
  and which account; after that the same trip is deducted automatically.
- Optional logos: add `public/logos/easytrip.png` and `public/logos/autosweep.png` (square).
  Only use logos you have the right to use; a letter badge is shown otherwise.

- **Route toll estimate**: the route card lists tolls on the planned route (amounts you've
  confirmed before) and each balance afterwards, in red with "reload needed" if it would go negative.
- **Balance font**: the free Passion One (Google Fonts). To use Pricedown instead, add a
  licensed `public/fonts/pricedown.woff2` (the free Pricedown download doesn't allow web/app use).

### Backup

Settings (⚙ in map view) → **Export backup** saves everything the app stores (explored map,
saved places, RFID balances, settings) to a file; **Import backup** restores it.

### Analytics

Google Tag Manager container `GTM-55ZWF5SM` loads on the web and in the apps (same code), with an
`app_platform` value (`web` / `android` / `ios`). Custom events pushed to the dataLayer:
`navigation_start`, `demo_drive`, `search`, `quick_find` (category), `place_view` (category),
`toll_deducted` (account, automatic). No locations, place names, search text or balances are sent.
Users can turn it off in ⚙ Settings → Privacy (then GTM isn't loaded at all).

### Sensors and background

- **Compass**: when you're stopped or walking, the arrow and map turn with the phone. iOS asks
  for motion access on your first tap.
- **Screen stays on** in drive view and while navigating (Wake Lock in browsers, native plugin in apps).
- **Background GPS (native apps only)**: during navigation, tracking continues with the screen off
  or in another app. Android shows a "NeonNav is navigating" notification; iOS shows the blue
  location indicator. Browsers can't track in the background.
- **Auto re-follow**: if you pan the map while navigating, it snaps back to you after 10 seconds.

### Place details

Tap any blip to open its card: category, distance, direction, rough drive time, address,
opening hours with an Open/Closed badge, phone, website and features. Data comes from
OpenStreetMap (Photon to find the place, then the OpenStreetMap API for its details), so how
much you see depends on what's been mapped.

Photos appear at the top of the card when available: first photos linked from the place's
OpenStreetMap entry (via Wikimedia Commons, Wikidata or Wikipedia), otherwise geotagged Commons
photos taken within 30 m, labelled "Nearby photo". Each photo shows its author and licence and
links to its Commons page, which the licences require. Tap a photo to view it full screen.

### Foursquare business search (optional)

OpenStreetMap often misses small businesses. With a free Foursquare developer account, search
also returns Foursquare places (shown first), and place cards fill in missing phone, website and
address. Only the cheaper "Pro" fields are requested.

1. Create a project at https://foursquare.com/developers and generate a **Service API key**.
2. Choose how the app gets the key:
   - **Personal builds:** create `.env.local` (git-ignored) with `VITE_FSQ_KEY=your_key`.
     The key ends up inside the built app, so don't share those builds.
   - **Shared builds (recommended):** deploy the proxy in `worker/fsq-proxy.js` to Cloudflare
     Workers (free) with the key as a secret, then set `VITE_FSQ_PROXY=https://…workers.dev`
     in `.env.local` and as the `FSQ_PROXY` repository secret for the GitHub APK build.
3. Rebuild (`npm run build`, or push to GitHub for a new APK).

This project's builds use the proxy at `https://neonnav-fsq.neonnavapp.workers.dev` by default
(the Foursquare key is stored there as the `FSQ_KEY` secret and never ships in the app).
Set `VITE_FSQ_PROXY=` (empty) to turn Foursquare off; if the proxy fails, search falls back to
OpenStreetMap only.

## Customising the look

- `src/style.js`: all map colours (`COLORS`), road widths, labels, and which POIs show as blips
- `src/icons.js`: blip icons and colours
- `src/styles.css`: HUD, radar, and panels
- App name / id: `capacitor.config.json`, `public/manifest.webmanifest`, `index.html`
- Native app icons: put a 1024px `assets/icon.png` and run `npx @capacitor/assets generate`

## Before publishing to the stores

- The OSRM demo server and Photon are free **fair-use** servers. For real users, self-host them
  (both are open source) or switch to a hosted plan (e.g. OpenRouteService, GraphHopper, Stadia Maps).
- Keep the OpenStreetMap / OpenFreeMap attribution visible (the (i) button).
- Keep the design original: don't use Rockstar/GTA names, logos, fonts, or icons.
