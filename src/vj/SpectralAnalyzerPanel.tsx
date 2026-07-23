import { useEffect, useRef, useState } from "react";
import type { AudioEngine } from "./audio/AudioEngine";

type AnalyzerView = "oscilloscope" | "spectrum" | "radial";

const VIEWS: Array<{ id: AnalyzerView; label: string }> = [
  { id: "oscilloscope", label: "OSCILLOSCOPE" },
  { id: "spectrum", label: "SPECTRUM" },
  { id: "radial", label: "RADIAL" },
];

function drawOscilloscope(context: CanvasRenderingContext2D, width: number, height: number, waveform: Uint8Array): void {
  const center = height * 0.5;
  context.strokeStyle = "rgba(53,220,255,.14)";
  context.beginPath();
  context.moveTo(0, center);
  context.lineTo(width, center);
  context.stroke();

  context.lineWidth = Math.max(1, height * 0.0035);
  context.strokeStyle = "rgba(117,244,197,.9)";
  context.beginPath();
  for (let index = 0; index < waveform.length; index += 1) {
    const sample = (waveform[index] - 128) / 128;
    const x = (index / (waveform.length - 1)) * width;
    const y = center + sample * height * 0.42;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
}

function drawSpectrum(context: CanvasRenderingContext2D, width: number, height: number, frequency: Uint8Array): void {
  const bars = 128;
  const barWidth = width / bars;
  for (let index = 0; index < bars; index += 1) {
    const sourceIndex = Math.min(frequency.length - 1, Math.floor((index / bars) ** 1.5 * frequency.length * 0.85));
    const level = frequency[sourceIndex] / 255;
    const barHeight = Math.max(1, level * height * 0.94);
    const hueMix = index / bars;
    context.fillStyle =
      hueMix < 0.34 ? "rgba(53,220,255,.85)" : hueMix < 0.67 ? "rgba(112,169,255,.8)" : "rgba(255,79,210,.78)";
    context.fillRect(index * barWidth, height - barHeight, Math.max(1, barWidth - 1), barHeight);
  }
}

function drawRadial(context: CanvasRenderingContext2D, width: number, height: number, frequency: Uint8Array): void {
  const cx = width / 2;
  const cy = height / 2;
  const baseRadius = Math.min(width, height) * 0.18;
  const maxExtra = Math.min(width, height) * 0.32;
  const points = 96;
  context.beginPath();
  for (let index = 0; index <= points; index += 1) {
    const sourceIndex = Math.min(frequency.length - 1, Math.floor((index / points) * frequency.length * 0.85));
    const level = frequency[sourceIndex % frequency.length] / 255;
    const angle = (index / points) * Math.PI * 2 - Math.PI / 2;
    const radius = baseRadius + level * maxExtra;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
  const gradient = context.createRadialGradient(cx, cy, baseRadius * 0.4, cx, cy, baseRadius + maxExtra);
  gradient.addColorStop(0, "rgba(53,220,255,.5)");
  gradient.addColorStop(0.55, "rgba(112,169,255,.4)");
  gradient.addColorStop(1, "rgba(255,79,210,.32)");
  context.fillStyle = gradient;
  context.fill();
  context.strokeStyle = "rgba(255,255,255,.35)";
  context.lineWidth = 1;
  context.stroke();

  context.beginPath();
  context.arc(cx, cy, baseRadius, 0, Math.PI * 2);
  context.strokeStyle = "rgba(255,255,255,.12)";
  context.stroke();
}

function Meter({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const danger = pct > 92;
  return (
    <div className="spectral-meter">
      <span className="spectral-meter-label">{label}</span>
      <div className="spectral-meter-track">
        <div className={`spectral-meter-fill ${danger ? "danger" : ""}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="spectral-meter-value">{pct}</span>
    </div>
  );
}

export interface SpectralAnalyzerPanelProps {
  audio: AudioEngine;
  onClose: () => void;
}

export function SpectralAnalyzerPanel({ audio, onClose }: SpectralAnalyzerPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<AnalyzerView>("spectrum");
  const [rms, setRms] = useState(0);
  const [peak, setPeak] = useState(0);
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    let frame = 0;
    let lastMeterUpdate = 0;

    const draw = (timestamp: number) => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(bounds.width * ratio));
      const height = Math.max(1, Math.round(bounds.height * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.clearRect(0, 0, width, height);

      const metrics = audio.getMetrics();
      if (viewRef.current === "oscilloscope") drawOscilloscope(context, width, height, metrics.waveform);
      else if (viewRef.current === "spectrum") drawSpectrum(context, width, height, metrics.frequency);
      else drawRadial(context, width, height, metrics.frequency);

      if (timestamp - lastMeterUpdate > 60) {
        setRms(metrics.masterLevel);
        setPeak(metrics.peakLevel);
        lastMeterUpdate = timestamp;
      }

      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [audio]);

  return (
    <section className="spectral-analyzer-panel" role="dialog" aria-modal="true" aria-label="Spectral Analyzer">
      <header>
        <div className="spectral-view-tabs">
          {VIEWS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={view === option.id ? "active" : ""}
              onClick={() => setView(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} aria-label="Close Spectral Analyzer">
          ×
        </button>
      </header>
      <canvas ref={canvasRef} className="spectral-analyzer-canvas" aria-label={`Live master audio ${view}`} />
      <div className="spectral-meters">
        <Meter label="RMS" value={rms} />
        <Meter label="PEAK" value={peak} />
      </div>
    </section>
  );
}
