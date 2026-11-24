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
