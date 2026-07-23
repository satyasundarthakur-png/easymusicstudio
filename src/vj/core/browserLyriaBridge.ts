import type {
  LyriaRealtimeAudioPoll,
  LyriaRealtimeConfig,
  LyriaRealtimeDeckId,
  LyriaRealtimeRequest,
  LyriaRealtimeSession,
} from "./lyriaRealtime";

// ---------------------------------------------------------------------------
// Gemini API key storage
//
// SECURITY NOTE: this key is stored in the browser (localStorage) and used
// directly from client-side JS to open a WebSocket straight to Google's API.
// That means the key is visible to anyone with access to this browser/device
// (dev tools, localStorage inspection, etc). This is an intentional, explicit
// trade-off chosen to make Lyria RealTime usable without the Tauri desktop
// app — it is NOT the same security posture as the desktop build, which keeps
// the key inside native Rust code. Do not reuse a key here that has access to
// anything sensitive beyond Gemini's free/low-cost generation quota.
// ---------------------------------------------------------------------------

const GEMINI_API_KEY_STORAGE_KEY = "vj-studio.geminiApiKey.v1";

export function getGeminiApiKey(): string | undefined {
  try {
    return localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY) || undefined;
  } catch {
    return undefined;
  }
}

export function setGeminiApiKey(key: string | undefined): void {
  try {
    if (key && key.trim()) localStorage.setItem(GEMINI_API_KEY_STORAGE_KEY, key.trim());
    else localStorage.removeItem(GEMINI_API_KEY_STORAGE_KEY);
  } catch {
    // Storage unavailable (private browsing, quota) — key just won't persist across reloads.
  }
}

export function hasGeminiApiKey(): boolean {
  return Boolean(getGeminiApiKey());
}

// ---------------------------------------------------------------------------
// Live Music (Lyria RealTime) WebSocket bridge
// ---------------------------------------------------------------------------

const LYRIA_MODEL = "models/lyria-realtime-exp";
const LYRIA_WS_ENDPOINT = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateMusic";
const SAMPLE_RATE_HZ = 48_000;
const CHANNELS = 2;
const AUDIO_FORMAT = "pcm16";

interface BidiConfigMessage {
  temperature: number;
  topK: number;
  seed?: number;
  guidance: number;
  bpm: number;
  density: number;
  brightness: number;
  scale: string;
  muteBass: boolean;
  muteDrums: boolean;
  onlyBassAndDrums: boolean;
  musicGenerationMode: string;
}

function toBidiConfig(config: LyriaRealtimeConfig): BidiConfigMessage {
  return {
    temperature: config.temperature,
    topK: config.topK,
    seed: config.seed,
    guidance: config.guidance,
    bpm: config.bpm,
    density: config.density,
    brightness: config.brightness,
    scale: config.scale,
    muteBass: config.muteBass,
    muteDrums: config.muteDrums,
    onlyBassAndDrums: config.onlyBassAndDrums,
    musicGenerationMode: config.musicGenerationMode,
  };
}

function base64ToByteArray(base64: string): number[] {
  const binary = atob(base64);
  const bytes = new Array<number>(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

class BrowserLyriaSession {
  readonly deck: LyriaRealtimeDeckId;
  private socket?: WebSocket;
  private setupCompleted = false;
  private setupPromise?: Promise<void>;
  private pendingChunks: number[][] = [];
  private bufferedBytes = 0;
  private streamedBytes = 0;
  private lastWarning?: string;
  private closed = false;
  private request: LyriaRealtimeRequest;
  private playing = false;

  constructor(deck: LyriaRealtimeDeckId, request: LyriaRealtimeRequest) {
    this.deck = deck;
    this.request = request;
  }

  private connect(apiKey: string): Promise<void> {
    if (this.setupPromise) return this.setupPromise;
    this.setupPromise = new Promise((resolve, reject) => {
      const socket = new WebSocket(`${LYRIA_WS_ENDPOINT}?key=${encodeURIComponent(apiKey)}`);
      this.socket = socket;
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ setup: { model: LYRIA_MODEL } }));
      });
      socket.addEventListener("message", (event) => {
        void (async () => {
          const raw = typeof event.data === "string" ? event.data : await (event.data as Blob).text();
          let message: {
            setupComplete?: unknown;
            serverContent?: { audioChunks?: Array<{ data?: string }> };
            warning?: string;
            filteredPrompt?: { filteredReason?: string };
          };
          try {
            message = JSON.parse(raw);
          } catch {
            return;
          }
          if (message.setupComplete && !this.setupCompleted) {
            this.setupCompleted = true;
            resolve();
            return;
          }
          if (message.warning) this.lastWarning = message.warning;
          if (message.filteredPrompt) this.lastWarning = message.filteredPrompt.filteredReason ?? "Prompt was filtered";
          if (message.serverContent?.audioChunks) {
            for (const chunk of message.serverContent.audioChunks) {
              if (!chunk.data) continue;
              const bytes = base64ToByteArray(chunk.data);
              this.pendingChunks.push(bytes);
              this.bufferedBytes += bytes.length;
            }
          }
        })();
      });
      socket.addEventListener("error", () => {
        if (!this.setupCompleted) reject(new Error("Could not connect to Lyria RealTime — check your Gemini API key"));
      });
      socket.addEventListener("close", () => {
        this.closed = true;
        if (!this.setupCompleted) reject(new Error("Lyria RealTime connection closed before setup completed"));
      });
    });
    return this.setupPromise;
  }

  private send(payload: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(payload));
  }

  async start(apiKey: string): Promise<LyriaRealtimeSession> {
    await this.connect(apiKey);
    this.send({ clientContent: { weightedPrompts: this.request.weightedPrompts.map((p) => ({ text: p.text, weight: p.weight })) } });
    this.send({ musicGenerationConfig: toBidiConfig(this.request.config) });
    this.send({ playbackControl: "PLAY" });
    this.playing = true;
    return this.toSession();
  }

  async update(request: LyriaRealtimeRequest): Promise<LyriaRealtimeSession> {
    this.request = request;
    this.send({ clientContent: { weightedPrompts: request.weightedPrompts.map((p) => ({ text: p.text, weight: p.weight })) } });
    this.send({ musicGenerationConfig: toBidiConfig(request.config) });
    return this.toSession();
  }

  stop(): void {
    if (this.playing) this.send({ playbackControl: "STOP" });
    this.playing = false;
    this.socket?.close();
    this.closed = true;
  }

  poll(): LyriaRealtimeAudioPoll {
    const chunks = this.pendingChunks;
    this.pendingChunks = [];
    const drainedBytes = chunks.reduce((sum, c) => sum + c.length, 0);
    this.streamedBytes += drainedBytes;
    const warning = this.lastWarning;
    this.lastWarning = undefined;
    return {
      deck: this.deck,
      sessionId: this.sessionId,
      sampleRateHz: SAMPLE_RATE_HZ,
      channels: CHANNELS,
      audioFormat: AUDIO_FORMAT,
      chunks,
      bufferedAudioBytes: Math.max(0, this.bufferedBytes - drainedBytes),
      streamedAudioBytes: this.streamedBytes,
      warning,
    };
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private get sessionId(): string {
    return `browser-${this.deck}`;
  }

  private toSession(): LyriaRealtimeSession {
    return {
      deck: this.deck,
      id: this.sessionId,
      provider: "browser_direct",
      model: LYRIA_MODEL,
      state: this.playing ? "playing" : "stopped",
      weightedPrompts: this.request.weightedPrompts,
      config: this.request.config,
      sampleRateHz: SAMPLE_RATE_HZ,
      channels: CHANNELS,
      audioFormat: AUDIO_FORMAT,
    };
  }
}

const sessions = new Map<LyriaRealtimeDeckId, BrowserLyriaSession>();

export function browserLyriaStatusAvailable(): boolean {
  return hasGeminiApiKey();
}

export async function startBrowserLyriaSession(
  request: LyriaRealtimeRequest,
  deck: LyriaRealtimeDeckId,
): Promise<LyriaRealtimeSession> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error("No Gemini API key set — add one in Settings to use Lyria RealTime in the browser");
  sessions.get(deck)?.stop();
  const session = new BrowserLyriaSession(deck, request);
  sessions.set(deck, session);
  return session.start(apiKey);
}

export async function updateBrowserLyriaSession(
  request: LyriaRealtimeRequest,
  deck: LyriaRealtimeDeckId,
): Promise<LyriaRealtimeSession> {
  const session = sessions.get(deck);
  if (!session || session.isClosed) return startBrowserLyriaSession(request, deck);
  return session.update(request);
}

export function stopBrowserLyriaSession(deck: LyriaRealtimeDeckId): void {
  sessions.get(deck)?.stop();
  sessions.delete(deck);
}

export function pollBrowserLyriaAudio(deck: LyriaRealtimeDeckId): LyriaRealtimeAudioPoll {
  const session = sessions.get(deck);
  if (!session) {
    return {
      deck,
      sampleRateHz: SAMPLE_RATE_HZ,
      channels: CHANNELS,
      audioFormat: AUDIO_FORMAT,
      chunks: [],
      bufferedAudioBytes: 0,
      streamedAudioBytes: 0,
    };
  }
  return session.poll();
}
