import { ITEMS, type ItemId, type WeaponId } from '../shared';
import { onSettingsChange, settings } from '../settings';

// Every sound is synthesised with WebAudio, so the game ships no audio files.
// Mix: voices -> (distance lowpass) -> (stereo pan) -> sfx bus ─┐
//      ambience --------------------------------> ambient bus ─┴-> master -> compressor -> speakers

/** Where a sound is relative to the listener. */
export interface Spot {
  vol: number;
  pan: number;
  /** 0 = right here, 1 = edge of hearing; drives the muffling lowpass. */
  far: number;
}

export const HERE: Spot = { vol: 1, pan: 0, far: 0 };
const HEARING = 1700;

export function falloff(distance: number): number {
  return Math.max(0, 1 - distance / HEARING) ** 1.4;
}

export function spotAt(dx: number, dy: number): Spot {
  const d = Math.hypot(dx, dy);
  return { vol: falloff(d), pan: Math.max(-1, Math.min(1, dx / 900)) * 0.75, far: Math.min(1, d / HEARING) };
}

// ------------------------------------------------------------------ graph

let ctx: AudioContext | null = null;
let master!: GainNode;
let sfxBus!: GainNode;
let ambBus!: GainNode;
let noiseBuf!: AudioBuffer;

function context(): AudioContext | null {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    comp.connect(ctx.destination);
    master = ctx.createGain();
    master.connect(comp);
    sfxBus = ctx.createGain();
    sfxBus.connect(master);
    ambBus = ctx.createGain();
    ambBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    applySettings();
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  return ctx;
}

function applySettings() {
  if (!ctx) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(settings.volume * 0.9, t, 0.05);
  sfxBus.gain.setTargetAtTime(settings.sfx ? 1 : 0, t, 0.05);
  ambBus.gain.setTargetAtTime(settings.ambient ? 1 : 0, t, 0.4);
  syncAmbient();
}
onSettingsChange(applySettings);

/** Browsers only allow audio after a user gesture. */
export function unlockAudio() {
  if (settings.volume > 0) context();
}

// ------------------------------------------------------------------ voices

const MAX_VOICES = 14;
let activeVoices = 0;
const lastPlayed = new Map<string, number>();

interface Voice {
  c: AudioContext;
  t: number;
  out: GainNode;
}

interface VoiceOpts {
  /** Sounds sharing a key are rate limited to one per `gap` ms. */
  key?: string;
  gap?: number;
  /** Bypasses the voice cap (own actions must never be dropped). */
  important?: boolean;
}

function voice(spot: Spot, level: number, lengthSec: number, opts: VoiceOpts = {}): Voice | null {
  if (!settings.sfx || settings.volume <= 0) return null;
  const vol = spot.vol * level;
  if (vol < 0.012) return null;
  const now = performance.now();
  if (opts.key) {
    if (now - (lastPlayed.get(opts.key) ?? -1e9) < (opts.gap ?? 0)) return null;
    lastPlayed.set(opts.key, now);
  }
  if (activeVoices >= MAX_VOICES && !opts.important) return null;
  const c = context();
  if (!c) return null;
  activeVoices++;
  setTimeout(() => activeVoices--, lengthSec * 1000 + 50);

  const out = c.createGain();
  out.gain.value = vol;
  let tail: AudioNode = out;
  if (spot.far > 0.05) {
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900 + 17000 * (1 - spot.far) ** 2.2;
    tail.connect(lp);
    tail = lp;
  }
  if (Math.abs(spot.pan) > 0.02 && typeof c.createStereoPanner === 'function') {
    const p = c.createStereoPanner();
    p.pan.value = spot.pan;
    tail.connect(p);
    tail = p;
  }
  tail.connect(sfxBus);
  return { c, t: c.currentTime + 0.005, out };
}

function envelope(v: Voice, at: number, peak: number, attack: number, decay: number): GainNode {
  const g = v.c.createGain();
  const t = v.t + at;
  g.gain.value = 0;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(v.out);
  return g;
}

interface Layer {
  at?: number;
  vol: number;
  attack?: number;
  decay: number;
  freq: number;
  freqTo?: number;
}

function noise(v: Voice, o: Layer & { type?: BiquadFilterType; q?: number }) {
  const at = o.at ?? 0;
  const attack = o.attack ?? 0.002;
  const t = v.t + at;
  const src = v.c.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = v.c.createBiquadFilter();
  f.type = o.type ?? 'lowpass';
  f.Q.value = o.q ?? 0.7;
  f.frequency.setValueAtTime(o.freq, t);
  if (o.freqTo) f.frequency.exponentialRampToValueAtTime(o.freqTo, t + attack + o.decay);
  src.connect(f).connect(envelope(v, at, o.vol, attack, o.decay));
  src.start(t, Math.random() * noiseBuf.duration);
  src.stop(t + attack + o.decay + 0.05);
}

function tone(v: Voice, o: Layer & { type?: OscillatorType }) {
  const at = o.at ?? 0;
  const attack = o.attack ?? 0.002;
  const t = v.t + at;
  const osc = v.c.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, t);
  if (o.freqTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqTo), t + attack + o.decay);
  osc.connect(envelope(v, at, o.vol, attack, o.decay));
  osc.start(t);
  osc.stop(t + attack + o.decay + 0.05);
}

const vary = (amount = 0.1) => 1 + (Math.random() - 0.5) * amount;

/** A short mechanical tick (bolt, magazine, pin). */
function click(v: Voice, at: number, vol: number, freq: number) {
  noise(v, { at, vol, decay: 0.025, type: 'bandpass', freq, q: 4 });
  tone(v, { at, vol: vol * 0.4, decay: 0.03, type: 'triangle', freq: freq * 0.5 });
}

// ------------------------------------------------------------------ guns

interface GunSound {
  level: number;
  len: number;
  play(v: Voice, p: number): void;
}

const GUNS: Partial<Record<WeaponId, GunSound>> = {
  pistol: {
    level: 0.5,
    len: 0.2,
    play(v, p) {
      noise(v, { vol: 0.45, decay: 0.04, type: 'highpass', freq: 2600 * p });
      noise(v, { vol: 0.8, decay: 0.11, type: 'bandpass', freq: 1300 * p, freqTo: 600, q: 0.9 });
      tone(v, { vol: 0.5, decay: 0.09, freq: 170 * p, freqTo: 55 });
    },
  },
  rifle: {
    level: 0.5,
    len: 0.25,
    play(v, p) {
      noise(v, { vol: 0.4, decay: 0.035, type: 'highpass', freq: 3000 * p });
      noise(v, { vol: 0.85, decay: 0.15, type: 'bandpass', freq: 950 * p, freqTo: 420, q: 0.8 });
      tone(v, { vol: 0.6, decay: 0.11, freq: 125 * p, freqTo: 45 });
      click(v, 0.04, 0.05, 2600);
    },
  },
  shotgun: {
    level: 0.6,
    len: 0.7,
    play(v, p) {
      noise(v, { vol: 0.35, decay: 0.06, type: 'highpass', freq: 2000 * p });
      noise(v, { vol: 1, decay: 0.28, freq: 1700 * p, freqTo: 350 });
      tone(v, { vol: 0.8, decay: 0.22, freq: 95 * p, freqTo: 35 });
      noise(v, { at: 0.03, vol: 0.2, attack: 0.03, decay: 0.45, freq: 600 });
      click(v, 0.42, 0.12, 1500);
      click(v, 0.55, 0.14, 1900);
    },
  },
  sniper: {
    level: 0.65,
    len: 1.3,
    play(v, p) {
      noise(v, { vol: 0.6, decay: 0.05, type: 'highpass', freq: 3500 * p });
      noise(v, { vol: 0.9, decay: 0.25, type: 'bandpass', freq: 720 * p, freqTo: 260, q: 0.7 });
      tone(v, { vol: 0.9, decay: 0.3, freq: 82 * p, freqTo: 30 });
      noise(v, { at: 0.03, vol: 0.25, attack: 0.04, decay: 0.9, freq: 520 });
      noise(v, { at: 0.2, vol: 0.12, attack: 0.02, decay: 0.45, freq: 700 });
      click(v, 0.7, 0.12, 1400);
      click(v, 0.86, 0.14, 2100);
    },
  },
};

// ------------------------------------------------------------------ effects

export type Surface = 'grass' | 'wood';

export const sfx = {
  shot(weapon: WeaponId, spot: Spot, own = false) {
    const gun = GUNS[weapon];
    if (!gun) return;
    const near = spot.vol > 0.45;
    const v = voice(spot, gun.level * (own ? 0.85 : 1), gun.len, {
      key: own ? undefined : `shot-${weapon}-${near ? 'n' : 'f'}`,
      gap: near ? 25 : 80,
      important: own,
    });
    if (v) gun.play(v, vary());
  },

  melee(spot: Spot) {
    const v = voice(spot, 0.35, 0.2, { key: 'melee', gap: 40 });
    if (!v) return;
    noise(v, { vol: 0.5, attack: 0.03, decay: 0.12, type: 'bandpass', freq: 700 * vary(), freqTo: 2600, q: 1.2 });
  },

  /** A bullet striking a player somewhere in the world. */
  hit(spot: Spot) {
    const v = voice(spot, 0.4, 0.12, { key: 'hit', gap: 45 });
    if (!v) return;
    tone(v, { vol: 0.6, decay: 0.07, freq: 230 * vary(), freqTo: 90 });
    noise(v, { vol: 0.35, decay: 0.05, freq: 900 });
  },

  /** Confirmation tick when your own shot lands. */
  hitMarker() {
    const v = voice(HERE, 0.22, 0.08, { key: 'hitmarker', gap: 55, important: true });
    if (!v) return;
    tone(v, { vol: 0.6, decay: 0.05, type: 'triangle', freq: 1900, freqTo: 1500 });
    tone(v, { vol: 0.25, decay: 0.03, freq: 2900 });
  },

  hurt() {
    const v = voice(HERE, 0.45, 0.2, { key: 'hurt', gap: 90, important: true });
    if (!v) return;
    tone(v, { vol: 0.7, decay: 0.14, freq: 150 * vary(), freqTo: 60 });
    noise(v, { vol: 0.4, decay: 0.1, freq: 500 });
  },

  boom(spot: Spot) {
    const v = voice(spot, 0.9, 2, { important: spot.vol > 0.3 });
    if (!v) return;
    noise(v, { vol: 0.7, decay: 0.1, freq: 3200 });
    noise(v, { vol: 1, attack: 0.005, decay: 0.9, freq: 1000, freqTo: 180 });
    tone(v, { vol: 1, decay: 0.8, freq: 70, freqTo: 28 });
    noise(v, { at: 0.04, vol: 0.45, attack: 0.08, decay: 1.7, freq: 280 });
    for (let i = 0; i < 4; i++) {
      noise(v, { at: 0.15 + Math.random() * 0.5, vol: 0.06, decay: 0.03, type: 'highpass', freq: 2500 + Math.random() * 2000 });
    }
  },

  reload(spot: Spot) {
    const v = voice(spot, 0.4, 0.8, { key: 'reload', gap: 150 });
    if (!v) return;
    click(v, 0, 0.5, 2300);
    noise(v, { at: 0.18, vol: 0.18, attack: 0.03, decay: 0.12, type: 'bandpass', freq: 1300, freqTo: 2800, q: 1.5 });
    click(v, 0.45, 0.6, 1700);
    click(v, 0.62, 0.5, 2600);
  },

  pickup(item?: ItemId) {
    const kind = item ? ITEMS[item]?.kind : undefined;
    const v = voice(HERE, 0.3, 0.3, { key: 'pickup', gap: 60, important: true });
    if (!v) return;
    if (kind === 'weapon') {
      click(v, 0, 0.6, 1800);
      click(v, 0.09, 0.7, 2600);
      tone(v, { at: 0.02, vol: 0.15, decay: 0.15, type: 'triangle', freq: 660 });
    } else if (kind === 'armor' || kind === 'bag') {
      noise(v, { vol: 0.45, attack: 0.04, decay: 0.16, type: 'bandpass', freq: 900, freqTo: 1800, q: 1 });
      tone(v, { at: 0.05, vol: 0.2, decay: 0.18, type: 'triangle', freq: 523, freqTo: 784 });
    } else {
      tone(v, { vol: 0.35, decay: 0.09, type: 'triangle', freq: 880 });
      tone(v, { at: 0.06, vol: 0.3, decay: 0.12, type: 'triangle', freq: 1320 });
    }
  },

  door(spot: Spot) {
    const v = voice(spot, 0.35, 0.3, { key: 'door', gap: 80 });
    if (!v) return;
    tone(v, { vol: 0.35, attack: 0.02, decay: 0.16, type: 'triangle', freq: 210 * vary(), freqTo: 140 });
    noise(v, { at: 0.1, vol: 0.45, decay: 0.08, freq: 650 });
  },

  chest(spot: Spot) {
    const v = voice(spot, 0.5, 0.5, { key: 'chest', gap: 100 });
    if (!v) return;
    noise(v, { vol: 0.8, decay: 0.14, type: 'bandpass', freq: 850, q: 1.1 });
    tone(v, { vol: 0.4, decay: 0.12, freq: 160, freqTo: 70 });
    for (let i = 0; i < 4; i++) {
      noise(v, { at: 0.06 + Math.random() * 0.25, vol: 0.12, decay: 0.03, type: 'bandpass', freq: 1200 + Math.random() * 1200, q: 3 });
    }
  },

  kill() {
    const v = voice(HERE, 0.28, 0.6, { important: true });
    if (!v) return;
    for (const [at, f] of [[0, 784], [0.09, 1175]] as const) {
      tone(v, { at, vol: 0.5, attack: 0.005, decay: 0.35, freq: f });
      tone(v, { at, vol: 0.15, attack: 0.005, decay: 0.2, type: 'triangle', freq: f * 2 });
    }
  },

  victory() {
    const v = voice(HERE, 0.3, 1.4, { important: true });
    if (!v) return;
    [523, 659, 784, 1047].forEach((f, i) => {
      tone(v, { at: i * 0.12, vol: 0.5, attack: 0.01, decay: i === 3 ? 0.9 : 0.3, freq: f });
      tone(v, { at: i * 0.12, vol: 0.15, attack: 0.01, decay: 0.25, type: 'triangle', freq: f * 2 });
    });
  },

  click() {
    const v = voice(HERE, 0.12, 0.05, { key: 'ui', gap: 30, important: true });
    if (!v) return;
    tone(v, { vol: 0.6, decay: 0.03, type: 'triangle', freq: 1400, freqTo: 1100 });
  },

  alert() {
    const v = voice(HERE, 0.2, 0.9, { important: true });
    if (!v) return;
    tone(v, { vol: 0.5, attack: 0.03, decay: 0.35, freq: 587 });
    tone(v, { at: 0.28, vol: 0.5, attack: 0.03, decay: 0.5, freq: 880 });
  },

  throwItem(spot: Spot) {
    const v = voice(spot, 0.3, 0.3, { key: 'throw', gap: 80 });
    if (!v) return;
    tone(v, { vol: 0.2, decay: 0.07, type: 'triangle', freq: 3100 });
    noise(v, { at: 0.04, vol: 0.5, attack: 0.05, decay: 0.15, type: 'bandpass', freq: 600, freqTo: 1900, q: 1 });
  },

  step(surface: Surface) {
    const v = voice(HERE, surface === 'wood' ? 0.1 : 0.07, 0.08, { key: 'step', gap: 110 });
    if (!v) return;
    if (surface === 'wood') {
      noise(v, { vol: 0.8, decay: 0.05, type: 'bandpass', freq: 750 * vary(0.2), q: 1.4 });
      tone(v, { vol: 0.3, decay: 0.04, freq: 140 * vary(0.2), freqTo: 90 });
    } else {
      noise(v, { vol: 0.8, attack: 0.008, decay: 0.06, freq: 520 * vary(0.3) });
    }
  },
};

// ------------------------------------------------------------------ ambience

let ambientWanted = false;
let ambientOut: GainNode | null = null;
let ambientSources: AudioScheduledSourceNode[] = [];
let birdTimer = 0;

/** Soft wind and surf with the odd bird; mixed well under gameplay sounds. */
export function startAmbient() {
  ambientWanted = true;
  syncAmbient();
}

export function stopAmbient() {
  ambientWanted = false;
  syncAmbient();
}

function syncAmbient() {
  const on = ambientWanted && settings.ambient && settings.volume > 0;
  if (on && !ambientOut) buildAmbient();
  else if (!on && ambientOut) teardownAmbient();
}

function loopedNoise(c: AudioContext, filter: BiquadFilterType, freq: number, q: number, base: number, lfoHz: number, depth: number, dest: AudioNode) {
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.value = base;
  const lfo = c.createOscillator();
  lfo.frequency.value = lfoHz;
  const amt = c.createGain();
  amt.gain.value = depth;
  lfo.connect(amt).connect(g.gain);
  src.connect(f).connect(g).connect(dest);
  src.start(c.currentTime, Math.random() * noiseBuf.duration);
  lfo.start();
  ambientSources.push(src, lfo);
}

function buildAmbient() {
  const c = context();
  if (!c) return;
  const out = c.createGain();
  out.gain.value = 0;
  out.gain.setTargetAtTime(1, c.currentTime, 1.2);
  out.connect(ambBus);
  ambientOut = out;
  loopedNoise(c, 'lowpass', 380, 0.5, 0.05, 0.07, 0.025, out);
  loopedNoise(c, 'bandpass', 320, 0.6, 0.03, 0.12, 0.028, out);
  scheduleBird();
}

function scheduleBird() {
  birdTimer = window.setTimeout(() => {
    if (!ambientOut) return;
    if (document.visibilityState === 'visible') chirp();
    scheduleBird();
  }, 3500 + Math.random() * 7000);
}

function chirp() {
  const c = ctx;
  if (!c || !ambientOut) return;
  const out = c.createGain();
  out.gain.value = 0.025 + Math.random() * 0.02;
  if (typeof c.createStereoPanner === 'function') {
    const p = c.createStereoPanner();
    p.pan.value = (Math.random() * 2 - 1) * 0.8;
    out.connect(p).connect(ambientOut);
  } else {
    out.connect(ambientOut);
  }
  const v: Voice = { c, t: c.currentTime + 0.01, out };
  const base = 2400 + Math.random() * 1600;
  const notes = 2 + Math.floor(Math.random() * 3);
  let at = 0;
  for (let i = 0; i < notes; i++) {
    const f = base * vary(0.15);
    const osc = c.createOscillator();
    const t = v.t + at;
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * 1.35, t + 0.04);
    osc.frequency.exponentialRampToValueAtTime(f * 0.9, t + 0.09);
    osc.connect(envelope(v, at, 1, 0.01, 0.08));
    osc.start(t);
    osc.stop(t + 0.12);
    at += 0.1 + Math.random() * 0.06;
  }
}

function teardownAmbient() {
  clearTimeout(birdTimer);
  const out = ambientOut;
  const sources = ambientSources;
  ambientOut = null;
  ambientSources = [];
  if (!out || !ctx) return;
  out.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
  setTimeout(() => {
    for (const s of sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    out.disconnect();
  }, 1500);
}
