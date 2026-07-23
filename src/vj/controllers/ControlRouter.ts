import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { WebMidi } from "webmidi";
import type { ControlAction, ControlMessage } from "../core/types";

export interface ControllerStatus {
  keyboard: boolean;
  globalShortcuts: boolean;
  logitechBridge: boolean;
  midi: boolean;
  midiInputs: string[];
}

type ControlListener = (message: ControlMessage) => void;
type StatusListener = (status: ControllerStatus) => void;

/// MIDI-learn: actions a note-on message can be bound to (fired once per
/// press, no meaningful continuous value).
export const MIDI_LEARNABLE_NOTE_ACTIONS: ControlAction[] = [
  "transport.toggle",
  "transport.stop",
  "transport.record",
  "tempo.tap",
  "track.next",
  "track.previous",
  "track.mute",
  "track.solo",
  "track.trigger",
  "visual.next",
  "visual.previous",
];

/// MIDI-learn: actions a control-change (fader/knob) message can be bound
/// to (continuous, normalized to roughly -1..1 around center).
export const MIDI_LEARNABLE_CC_ACTIONS: ControlAction[] = [
  "master.delta",
  "visual.intensity.delta",
  "tempo.delta",
  "visual.sculpture.delta",
  "visual.motion.delta",
  "visual.atmosphere.delta",
  "visual.ribbon.delta",
  "visual.temporal.speed.delta",
  "visual.temporal.strobe.delta",
  "visual.temporal.trail.delta",
  "visual.temporal.morph.delta",
  "visual.temporal.camera.delta",
  "visual.temporal.phase.delta",
];

export interface MidiMapping {
  kind: "note" | "cc";
  key: number;
  action: ControlAction;
}

export interface MidiLearnEvent {
  action: ControlAction;
  kind: "note" | "cc";
  key: number;
}

type LearnListener = (event: MidiLearnEvent) => void;

const MIDI_MAPPINGS_STORAGE_KEY = "vj-studio.midi.mappings.v1";

function loadCustomMidiMappings(): MidiMapping[] {
  try {
    const raw = localStorage.getItem(MIDI_MAPPINGS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is MidiMapping =>
        entry &&
        (entry.kind === "note" || entry.kind === "cc") &&
        typeof entry.key === "number" &&
        typeof entry.action === "string",
    );
  } catch {
    return [];
  }
}

function saveCustomMidiMappings(mappings: MidiMapping[]): void {
  try {
    localStorage.setItem(MIDI_MAPPINGS_STORAGE_KEY, JSON.stringify(mappings));
  } catch {
    // Storage unavailable (private browsing, quota) — mappings stay in-memory for this session.
  }
}

const KEYBOARD_ACTIONS: Record<string, { action: ControlAction; value?: number }> = {
  Space: { action: "transport.toggle" },
  MediaPlayPause: { action: "transport.toggle" },
  KeyR: { action: "transport.record" },
  KeyT: { action: "tempo.tap" },
  KeyM: { action: "track.mute" },
  KeyS: { action: "track.solo" },
  Enter: { action: "track.trigger" },
  ArrowUp: { action: "track.previous" },
  ArrowDown: { action: "track.next" },
  ArrowLeft: { action: "visual.previous" },
  ArrowRight: { action: "visual.next" },
  BracketLeft: { action: "visual.intensity.delta", value: -1 },
  BracketRight: { action: "visual.intensity.delta", value: 1 },
  Minus: { action: "master.delta", value: -1 },
  Equal: { action: "master.delta", value: 1 },
  Digit1: { action: "visual.scene.select", value: 0 },
  Digit2: { action: "visual.scene.select", value: 1 },
  Digit3: { action: "visual.scene.select", value: 2 },
  Digit4: { action: "visual.scene.select", value: 3 },
  Digit5: { action: "visual.scene.select", value: 4 },
  Digit6: { action: "visual.scene.select", value: 5 },
  Digit7: { action: "visual.scene.select", value: 6 },
  Digit8: { action: "visual.scene.select", value: 7 },
};

export function keyboardControlFor(code: string, shiftKey = false): { action: ControlAction; value?: number } | undefined {
  if (shiftKey && /^Digit[1-4]$/.test(code)) {
    return { action: "lyria.deck-scene.select", value: Number(code.slice(-1)) - 1 };
  }
  return KEYBOARD_ACTIONS[code];
}

const GLOBAL_SHORTCUTS: Array<[string, ControlAction, number?]> = [
  ["F13", "transport.toggle"],
  ["F14", "transport.record"],
  ["F15", "track.previous"],
  ["F16", "track.next"],
  ["F17", "track.mute"],
  ["F18", "track.solo"],
  ["F19", "visual.previous"],
  ["F20", "visual.next"],
  ["F21", "visual.intensity.delta", -1],
  ["F22", "visual.intensity.delta", 1],
  ["F23", "master.delta", -1],
  ["F24", "master.delta", 1],
];

export class ControlRouter {
  private controlListeners = new Set<ControlListener>();
  private statusListeners = new Set<StatusListener>();
  private learnListeners = new Set<LearnListener>();
  private unlistenBridge?: UnlistenFn;
  private webMidiStarted = false;
  private started = false;
  private lifecycle: Promise<void> = Promise.resolve();
  private status: ControllerStatus = {
    keyboard: true,
    globalShortcuts: false,
    logitechBridge: false,
    midi: false,
    midiInputs: [],
  };

  private customMappings: MidiMapping[] = loadCustomMidiMappings();
  private noteMap = new Map<number, ControlAction>();
  private ccMap = new Map<number, ControlAction>();
  private learnTarget: { kind: "note" | "cc"; action: ControlAction } | null = null;

  constructor() {
    this.rebuildMaps();
  }

  private rebuildMaps(): void {
    this.noteMap.clear();
    this.ccMap.clear();
    for (const mapping of this.customMappings) {
      if (mapping.kind === "note") this.noteMap.set(mapping.key, mapping.action);
      else this.ccMap.set(mapping.key, mapping.action);
    }
  }

  /// Enters MIDI-learn mode for a given action: the next matching MIDI
  /// message (note-on for note-learnable actions, control-change for
  /// CC-learnable actions) is captured and bound, instead of being
  /// dispatched as a normal control message. Call cancelMidiLearn() to
  /// back out without binding anything.
  startMidiLearn(action: ControlAction): void {
    const kind: "note" | "cc" = MIDI_LEARNABLE_CC_ACTIONS.includes(action) ? "cc" : "note";
    this.learnTarget = { kind, action };
  }

  cancelMidiLearn(): void {
    this.learnTarget = null;
  }

  isMidiLearning(): boolean {
    return this.learnTarget !== null;
  }

  /// Removes any custom binding(s) pointing at this action, reverting it
  /// to the fixed default (or to unbound, if it had no default).
  clearMidiMapping(action: ControlAction): void {
    this.customMappings = this.customMappings.filter((mapping) => mapping.action !== action);
    this.rebuildMaps();
    saveCustomMidiMappings(this.customMappings);
  }

  clearAllMidiMappings(): void {
    this.customMappings = [];
    this.rebuildMaps();
    saveCustomMidiMappings(this.customMappings);
  }

  getMidiMappings(): MidiMapping[] {
    return [...this.customMappings];
  }

  subscribeMidiLearn(listener: LearnListener): () => void {
    this.learnListeners.add(listener);
    return () => this.learnListeners.delete(listener);
  }

  private emitLearned(event: MidiLearnEvent): void {
    for (const listener of this.learnListeners) listener(event);
  }

  private bindMidiLearnCapture(kind: "note" | "cc", key: number): boolean {
    if (!this.learnTarget || this.learnTarget.kind !== kind) return false;
    const { action } = this.learnTarget;
    this.customMappings = this.customMappings.filter((mapping) => mapping.action !== action);
    this.customMappings.push({ kind, key, action });
    this.rebuildMaps();
    saveCustomMidiMappings(this.customMappings);
    this.learnTarget = null;
    this.emitLearned({ action, kind, key });
    return true;
  }

  start(): Promise<void> {
    const operation = this.lifecycle.then(() => this.startNow());
    this.lifecycle = operation.catch(() => undefined);
    return operation;
  }

  stop(): Promise<void> {
    const operation = this.lifecycle.then(() => this.stopNow());
    this.lifecycle = operation.catch(() => undefined);
    return operation;
  }

  private async startNow(): Promise<void> {
    if (this.started) return;
    this.started = true;
    window.addEventListener("keydown", this.onKeyDown);
    this.startMediaSession();
    await Promise.allSettled([this.startTauriInputs(), this.startMidi()]);
  }

  private async stopNow(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    window.removeEventListener("keydown", this.onKeyDown);
    this.stopMediaSession();
    this.unlistenBridge?.();
    this.unlistenBridge = undefined;
    if (this.status.globalShortcuts && isTauri()) {
      const { unregisterAll } = await import("@tauri-apps/plugin-global-shortcut");
      await unregisterAll().catch(() => undefined);
    }
    if (this.webMidiStarted) {
      for (const input of WebMidi.inputs) input.removeListener();
      WebMidi.removeListener("connected");
      WebMidi.removeListener("disconnected");
      WebMidi.disable();
      this.webMidiStarted = false;
    }
    this.status = {
      keyboard: true,
      globalShortcuts: false,
      logitechBridge: false,
      midi: false,
      midiInputs: [],
    };
    this.emitStatus();
  }

  subscribe(listener: ControlListener): () => void {
    this.controlListeners.add(listener);
    return () => this.controlListeners.delete(listener);
  }

  subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener({ ...this.status, midiInputs: [...this.status.midiInputs] });
    return () => this.statusListeners.delete(listener);
  }

  dispatch(action: ControlAction, value?: number, source: ControlMessage["source"] = "ui"): void {
    const message: ControlMessage = { action, value, source, timestamp: performance.now() };
    for (const listener of this.controlListeners) listener(message);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat && !["BracketLeft", "BracketRight", "Minus", "Equal"].includes(event.code)) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
    const mapping = keyboardControlFor(event.code, event.shiftKey);
    if (!mapping) return;
    event.preventDefault();
    this.dispatch(mapping.action, mapping.value, "keyboard");
  };

  private startMediaSession(): void {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.setActionHandler("play", () => this.dispatch("transport.toggle", undefined, "keyboard"));
      navigator.mediaSession.setActionHandler("pause", () => this.dispatch("transport.toggle", undefined, "keyboard"));
    } catch (error) {
      console.info("Media key handling is unavailable in this webview", error);
    }
  }

  private stopMediaSession(): void {
    if (!("mediaSession" in navigator)) return;
    for (const action of ["play", "pause"] as const) {
      try {
        navigator.mediaSession.setActionHandler(action, null);
      } catch {
        // Ignore unsupported media session actions during teardown.
      }
    }
  }

  private async startTauriInputs(): Promise<void> {
    if (!isTauri()) return;
    this.unlistenBridge = await listen<{ action: ControlAction; value?: number; source?: "logitech" | "shortcut" }>(
      "controller://action",
      (event) => {
        this.status.logitechBridge = event.payload.source === "logitech" || this.status.logitechBridge;
        this.emitStatus();
        this.dispatch(event.payload.action, event.payload.value, event.payload.source ?? "logitech");
      },
    );

    try {
      const { register } = await import("@tauri-apps/plugin-global-shortcut");
      for (const [shortcut, action, value] of GLOBAL_SHORTCUTS) {
        await register(shortcut, (event) => {
          if (event.state === "Pressed") this.dispatch(action, value, "shortcut");
        });
      }
      this.status.globalShortcuts = true;
      this.emitStatus();
    } catch (error) {
      console.warn("Global shortcuts are unavailable", error);
      const { unregisterAll } = await import("@tauri-apps/plugin-global-shortcut");
      await unregisterAll().catch(() => undefined);
      this.status.globalShortcuts = false;
      this.emitStatus();
    }
  }

  private async startMidi(): Promise<void> {
    try {
      await WebMidi.enable({ sysex: false });
      this.webMidiStarted = true;
      this.bindMidiInputs();
      WebMidi.addListener("connected", () => this.bindMidiInputs());
      WebMidi.addListener("disconnected", () => this.bindMidiInputs());
    } catch (error) {
      console.info("MIDI access is unavailable in this webview", error);
    }
  }

  private bindMidiInputs(): void {
    if (!this.webMidiStarted) return;
    const inputNames = WebMidi.inputs.map((input) => input.name);
    for (const input of WebMidi.inputs) {
      input.removeListener("noteon");
      input.removeListener("controlchange");
      input.addListener("noteon", (event) => this.onMidiNote(event.note.number, event.rawValue ?? 0));
      input.addListener("controlchange", (event) => this.onMidiControl(event.controller.number, event.rawValue ?? 64));
    }
    this.status.midiInputs = inputNames;
    this.status.midi = inputNames.length > 0;
    this.emitStatus();
  }

  private onMidiNote(key: number, velocity: number): void {
    if (velocity <= 0) return;
    if (this.bindMidiLearnCapture("note", key)) return;

    const learned = this.noteMap.get(key);
    if (learned) {
      this.dispatch(learned, 0, "midi");
      return;
    }

    if (key >= 36 && key <= 41) this.dispatch("track.trigger", key - 36, "midi");
    else if (key === 42) this.dispatch("transport.toggle", 0, "midi");
    else if (key === 43) this.dispatch("transport.record", 0, "midi");
    else if (key >= 48 && key <= 55) this.dispatch("visual.scene.select", key - 48, "midi");
    else if (key >= 60 && key <= 71) this.dispatch("performance.template.select", key - 60, "midi");
  }

  private onMidiControl(key: number, value: number): void {
    if (this.bindMidiLearnCapture("cc", key)) return;

    const normalized = (value - 64) / 63;
    const learned = this.ccMap.get(key);
    if (learned) {
      this.dispatch(learned, normalized, "midi");
      return;
    }

    if (key === 1) this.dispatch("master.delta", normalized, "midi");
    if (key === 2) this.dispatch("visual.intensity.delta", normalized, "midi");
    if (key === 3) this.dispatch("tempo.delta", normalized, "midi");
    if (key === 4) this.dispatch("visual.sculpture.delta", normalized, "midi");
    if (key === 5) this.dispatch("visual.motion.delta", normalized, "midi");
    if (key === 6) this.dispatch("visual.atmosphere.delta", normalized, "midi");
    if (key === 7) this.dispatch("visual.ribbon.delta", normalized, "midi");
    if (key === 8) this.dispatch("visual.temporal.speed.delta", normalized, "midi");
    if (key === 9) this.dispatch("visual.temporal.strobe.delta", normalized, "midi");
    if (key === 10) this.dispatch("visual.temporal.trail.delta", normalized, "midi");
    if (key === 11) this.dispatch("visual.temporal.morph.delta", normalized, "midi");
    if (key === 12) this.dispatch("visual.temporal.camera.delta", normalized, "midi");
    if (key === 13) this.dispatch("visual.temporal.phase.delta", normalized, "midi");
  }

  private emitStatus(): void {
    const snapshot = { ...this.status, midiInputs: [...this.status.midiInputs] };
    for (const listener of this.statusListeners) listener(snapshot);
  }
}

export class TapTempo {
  private taps: number[] = [];

  tap(at = performance.now()): number | undefined {
    this.taps = this.taps.filter((tap) => at - tap <= 3_000);
    this.taps.push(at);
    if (this.taps.length < 2) return undefined;
    const intervals = this.taps.slice(1).map((tap, index) => tap - this.taps[index]);
    const sorted = [...intervals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median <= 0) return undefined;
    return Math.round(Math.min(200, Math.max(60, 60_000 / median)));
  }
}
