import { useEffect, useState } from "react";
import type { ControlAction } from "./core/types";
import {
  MIDI_LEARNABLE_CC_ACTIONS,
  MIDI_LEARNABLE_NOTE_ACTIONS,
  type ControlRouter,
  type MidiMapping,
} from "./controllers/ControlRouter";

const ACTION_LABELS: Partial<Record<ControlAction, string>> = {
  "transport.toggle": "Play / Pause",
  "transport.stop": "Stop",
  "transport.record": "Record",
  "tempo.tap": "Tap Tempo",
  "track.next": "Next Track",
  "track.previous": "Previous Track",
  "track.mute": "Mute Track",
  "track.solo": "Solo Track",
  "track.trigger": "Trigger Track",
  "visual.next": "Next Visual",
  "visual.previous": "Previous Visual",
  "master.delta": "Master Volume",
  "visual.intensity.delta": "Visual Intensity",
  "tempo.delta": "Tempo",
  "visual.sculpture.delta": "Visual Sculpture",
  "visual.motion.delta": "Visual Motion",
  "visual.atmosphere.delta": "Visual Atmosphere",
  "visual.ribbon.delta": "Visual Ribbon",
  "visual.temporal.speed.delta": "Temporal Speed",
  "visual.temporal.strobe.delta": "Temporal Strobe",
  "visual.temporal.trail.delta": "Temporal Trail",
  "visual.temporal.morph.delta": "Temporal Morph",
  "visual.temporal.camera.delta": "Temporal Camera",
  "visual.temporal.phase.delta": "Temporal Phase",
};

function labelFor(action: ControlAction): string {
  return ACTION_LABELS[action] ?? action;
}

function mappingLabel(mapping: MidiMapping | undefined): string {
  if (!mapping) return "Unbound";
  return mapping.kind === "note" ? `Note ${mapping.key}` : `CC ${mapping.key}`;
}

export interface MidiLearnPanelProps {
  router: ControlRouter;
  onClose: () => void;
}

export function MidiLearnPanel({ router, onClose }: MidiLearnPanelProps) {
  const [mappings, setMappings] = useState<MidiMapping[]>(() => router.getMidiMappings());
  const [learning, setLearning] = useState<ControlAction | null>(null);

  useEffect(() => {
    const unsubscribe = router.subscribeMidiLearn((event) => {
      setMappings(router.getMidiMappings());
      setLearning(null);
      void event;
    });
    return () => {
      unsubscribe();
      router.cancelMidiLearn();
    };
  }, [router]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // If we're mid-learn, Escape cancels the capture first; a second
      // Escape (or one when not learning) closes the whole panel.
      if (learning) {
        router.cancelMidiLearn();
        setLearning(null);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [learning, onClose, router]);

  const mappingFor = (action: ControlAction): MidiMapping | undefined => mappings.find((m) => m.action === action);

  const beginLearn = (action: ControlAction) => {
    router.startMidiLearn(action);
    setLearning(action);
  };

  const cancelLearn = () => {
    router.cancelMidiLearn();
    setLearning(null);
  };

  const clearOne = (action: ControlAction) => {
    router.clearMidiMapping(action);
    setMappings(router.getMidiMappings());
  };

  const clearAll = () => {
    router.clearAllMidiMappings();
    setMappings(router.getMidiMappings());
    setLearning(null);
  };

  const renderRow = (action: ControlAction) => {
    const mapping = mappingFor(action);
    const isLearning = learning === action;
    return (
      <div className="midi-learn-row" key={action}>
        <span className="midi-learn-name">{labelFor(action)}</span>
        <span className={`midi-learn-binding ${mapping ? "bound" : ""}`}>{isLearning ? "Listening…" : mappingLabel(mapping)}</span>
        {isLearning ? (
          <button type="button" onClick={cancelLearn}>
            CANCEL
          </button>
        ) : (
          <button type="button" onClick={() => beginLearn(action)}>
            LEARN
          </button>
        )}
        {mapping && !isLearning && (
          <button type="button" className="midi-learn-clear" onClick={() => clearOne(action)} aria-label={`Clear binding for ${labelFor(action)}`}>
            ×
          </button>
        )}
      </div>
    );
  };

  return (
    <section className="midi-learn-panel" role="dialog" aria-modal="true" aria-label="MIDI Learn">
      <header>
        <h2>MIDI Learn</h2>
        <button type="button" onClick={onClose} aria-label="Close MIDI Learn">
          ×
        </button>
      </header>
      <p className="midi-learn-hint">
        Click LEARN next to a control, then press a pad/key or move a fader/knob on your MIDI device to bind it. Bindings are saved on this
        device and take priority over the built-in defaults.
      </p>
      <div className="midi-learn-columns">
        <div>
          <h3>Triggers (notes/pads)</h3>
          {MIDI_LEARNABLE_NOTE_ACTIONS.map(renderRow)}
        </div>
        <div>
          <h3>Continuous (faders/knobs)</h3>
          {MIDI_LEARNABLE_CC_ACTIONS.map(renderRow)}
        </div>
      </div>
      <footer>
        <button type="button" onClick={clearAll}>
          CLEAR ALL BINDINGS
        </button>
      </footer>
    </section>
  );
}
