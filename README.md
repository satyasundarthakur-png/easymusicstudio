# VJ Studio — Live Performance Surface

A browser-based live VJ/DJ instrument: real-time audio-reactive visuals, an
AI music generation deck (Lyria RealTime), MIDI control, and loop pads —
built with React, TypeScript, TanStack Start, and Three.js.

## Quick start

1. Open the app. You'll land on a first-run setup wizard — pick a music
   direction and genre, then continue through to the welcome screen.
2. On the welcome screen, either:
   - Click **ENTER WITHOUT AUDIO** to jump straight into the full app with
     local features only (visuals, loop pads, MIDI, spectral analyzer), or
   - Add a **Gemini API key** (see below) to unlock live AI music generation
     via **START SESSION**.
3. Once inside, load an audio file into a loop pad (click the **+** or drag
   a file directly onto the pad) and press the pad to play it on the next
   bar.

## Enabling AI music generation (Lyria RealTime)

This app can generate live, steerable instrumental music using Google's
**Lyria RealTime** model, called directly from your browser.

1. Get a free API key at **[aistudio.google.com/apikey](https://aistudio.google.com/apikey)**
   (a Google account and a moment's signup — no special access request
   needed, Lyria RealTime works with a standard key).
2. Paste it in either of two places:
   - The **welcome screen**, in the box that appears under "ENTER WITHOUT
     AUDIO" once you've completed setup, *or*
   - Inside the app: expand the **AV OUTPUT** panel in the right-hand
     settings column → **LYRIA REALTIME (BROWSER)** section.
3. Click **SAVE KEY**. The Lyria panel status should flip from `OFFLINE` to
   `READY`, and **START SESSION** becomes clickable.

**Security note:** this key is stored in your browser's `localStorage` and
used directly from client-side JavaScript. It is visible to anyone with
access to this browser/device (dev tools, etc.) — do not use a key that has
access to anything beyond a low-cost/free generation quota. This is a
deliberate trade-off for running Lyria without a server component; the
[Tauri desktop build](#desktop-app) keeps the key server-side (in native
code) instead, if you need a more locked-down setup.

## Features

- **Visual engine** — 9+ audio-reactive Three.js scenes, adjustable
  intensity/color/animation, artist macros, temporal controls.
- **Loop pads** — load MP3/WAV/M4A/AAC/OGG/FLAC files by click or
  drag-and-drop; bar-synced playback.
- **Lyria RealTime** — steerable AI instrumental generation across a main
  deck plus sequence/vocal companion decks, with style presets and
  deck-scene recall.
- **MIDI Learn** — bind any supported MIDI controller's pads/knobs/faders to
  app actions by clicking LEARN and moving the control; bindings persist
  per-browser.
- **Spectral Analyzer** — full-screen oscilloscope / spectrum / radial views
  with live RMS and peak meters (click the small visualizer in the footer
  to expand it).
- **AV output** — record video+audio or audio-only captures of a
  performance.
- **Workspace settings** — export/import all settings (styles, FX, deck
  scenes, onboarding preferences) as a JSON file.

## Known limitations of this web build

A few features only work in the desktop (Tauri) build of this app, not
here in the browser:

- **Global keyboard shortcuts** outside the browser tab
- **Native file save dialogs** (falls back to browser download instead)
- **Auto-update** checks
- **Logitech MX Console** hardware bridge
- **"Assist AI" sign-in** — this is tied to the desktop app's native OAuth
  bridge and does not appear in the web build at all

None of these affect the core VJ/DJ/AI-generation workflow described above.

## Desktop app

A more locked-down desktop build (Tauri) exists in the original source
repository under `apps/musica-vj`, with a native shell around the same
frontend. Building it requires the Rust toolchain:

```sh
cd apps/musica-vj
npm install
npm run tauri dev     # local dev build
npm run tauri build   # production build for your OS
```

## Development

```sh
npm install
npm run dev      # local dev server
npm run build    # production build (Cloudflare Worker / Nitro output)
npx tsc --noEmit # typecheck
```

## Built with

- TanStack Start (file-based routing, SSR via Cloudflare Workers)
- TypeScript, React
- Tailwind CSS
- Three.js (visual engine)
- Web MIDI API, `@tonejs/midi`
- Google Gemini API — Lyria RealTime (Live Music API)
