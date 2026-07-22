import { useEffect, useState } from "react";
import { App } from "./App";
import { DjControlWindow } from "./DjControlWindow";
import type { DjControlProfileId } from "./core/djControls";

/**
 * Client-only entry for the VJ Studio app.
 *
 * This module (and its entire import graph — AudioEngine, VisualEngine,
 * MIDI, Tauri, IndexedDB, localStorage, Web Audio, Three.js, etc.) is
 * loaded via React.lazy behind <ClientOnly>, so nothing here runs on the
 * server. That means we do NOT need to sprinkle isBrowser/typeof-window
 * guards through every module — the whole tree is a client-only boundary.
 */
export default function VjClient() {
  const [profile, setProfile] = useState<DjControlProfileId | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("dj-control");
    if (p === "mixer" || p === "launcher" || p === "visual") {
      setProfile(p);
    }
    setReady(true);
  }, []);

  if (!ready) return null;
  return profile ? <DjControlWindow profile={profile} /> : <App />;
}
