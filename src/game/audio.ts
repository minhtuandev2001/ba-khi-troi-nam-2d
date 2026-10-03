import { ITEMS, type ItemId, type WeaponId } from '../shared';
import { onSettingsChange, settings } from '../settings';

// Every sound is synthesised with WebAudio, so the game ships no audio files.
// Mix: voices -> (distance lowpass) -> (stereo pan) -> sfx bus ─┐
//      ambience --------------------------------> ambient bus ─┤
//      menu music -> (echo) ----------------------> music bus ─┴-> master -> compressor -> speakers

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
let musicBus!: GainNode;
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
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.55;
    musicBus.connect(master);
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
  syncMusic();
}
onSettingsChange(applySettings);

/** Browsers only allow audio after a user gesture. */
export function unlockAudio() {
  if (settings.volume > 0) context();
}

/** Unlocks audio on the first gesture anywhere, so the menu music starts without waiting for a particular button. */
export function unlockOnFirstGesture() {
  const events = ['pointerdown', 'keydown', 'touchend'] as const;
  const handler = () => {
    if (ctx?.state === 'running') {
      for (const e of events) window.removeEventListener(e, handler, true);
      return;
    }
    unlockAudio();
  };
  for (const e of events) window.addEventListener(e, handler, true);
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

/** A plucked bowstring: a bright snap settling into a pitched, quickly damped hum. */
function twang(v: Voice, at: number, vol: number, freq: number, decay: number) {
  noise(v, { at, vol: vol * 0.7, decay: 0.03, type: 'bandpass', freq: freq * 9, q: 2 });
  tone(v, { at, vol, decay, type: 'triangle', freq: freq * 1.06, freqTo: freq });
  tone(v, { at, vol: vol * 0.3, decay: decay * 0.6, type: 'sawtooth', freq: freq * 2.01, freqTo: freq * 2 });
}

/** Air torn by a shaft leaving the bow. */
function whoosh(v: Voice, at: number, vol: number, from: number, to: number, decay: number) {
  noise(v, { at, vol, attack: 0.015, decay, type: 'bandpass', freq: from, freqTo: to, q: 1.4 });
}

// ------------------------------------------------------------------ bows

interface GunSound {
  level: number;
  len: number;
  play(v: Voice, p: number): void;
}

const GUNS: Partial<Record<WeaponId, GunSound>> = {
  // ống thổi: a sharp breath through bamboo and the dart's thin whistle
  pistol: {
    level: 0.45,
    len: 0.2,
    play(v, p) {
      noise(v, { vol: 0.9, attack: 0.004, decay: 0.07, type: 'bandpass', freq: 1500 * p, freqTo: 900, q: 1.2 });
      tone(v, { vol: 0.35, decay: 0.05, freq: 320 * p, freqTo: 160 });
      whoosh(v, 0.02, 0.25, 4200 * p, 2400, 0.12);
    },
  },
  // cung tên: string snap, hum and the arrow cutting away
  rifle: {
    level: 0.5,
    len: 0.3,
    play(v, p) {
      twang(v, 0, 0.7, 196 * p, 0.16);
      whoosh(v, 0.015, 0.4, 2600 * p, 900, 0.16);
    },
  },
  // nỏ: the heavy lever thunk, a deep horn-prod twang, a hiss of bolts and the crank re-cocking
  shotgun: {
    level: 0.6,
    len: 0.75,
    play(v, p) {
      noise(v, { vol: 0.9, decay: 0.09, freq: 1400 * p, freqTo: 300 });
      tone(v, { vol: 0.6, decay: 0.12, freq: 120 * p, freqTo: 60 });
      twang(v, 0.005, 0.7, 130 * p, 0.28);
      whoosh(v, 0.02, 0.5, 2200 * p, 700, 0.22);
      click(v, 0.42, 0.14, 1100);
      click(v, 0.5, 0.12, 1400);
      click(v, 0.58, 0.16, 900);
    },
  },
  // thần tiễn: a deep golden twang that rings on, a long rush of air and a shimmer of bronze
  sniper: {
    level: 0.65,
    len: 1.2,
    play(v, p) {
      noise(v, { vol: 0.7, decay: 0.05, type: 'bandpass', freq: 1800 * p, q: 1.5 });
      twang(v, 0, 0.9, 98 * p, 0.55);
      tone(v, { vol: 0.25, attack: 0.01, decay: 0.45, freq: 294 * p });
      whoosh(v, 0.02, 0.55, 3200 * p, 600, 0.6);
      tone(v, { at: 0.03, vol: 0.08, attack: 0.02, decay: 0.7, freq: 1760 });
      tone(v, { at: 0.06, vol: 0.06, attack: 0.02, decay: 0.6, freq: 2637 });
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

  /** A shot striking a player somewhere in the world. */
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

  /** Arrows drawn from the quiver, nocked with a wooden tick and the string eased back. */
  reload(spot: Spot) {
    const v = voice(spot, 0.4, 0.8, { key: 'reload', gap: 150 });
    if (!v) return;
    noise(v, { vol: 0.25, attack: 0.05, decay: 0.18, type: 'bandpass', freq: 1400, freqTo: 3200, q: 1.2 });
    click(v, 0.3, 0.5, 1200);
    tone(v, { at: 0.42, vol: 0.12, attack: 0.08, decay: 0.2, type: 'triangle', freq: 180, freqTo: 240 });
    click(v, 0.62, 0.4, 900);
  },

  pickup(item?: ItemId) {
    const kind = item ? ITEMS[item]?.kind : undefined;
    const v = voice(HERE, 0.3, 0.3, { key: 'pickup', gap: 60, important: true });
    if (!v) return;
    if (kind === 'weapon') {
      click(v, 0, 0.6, 1100);
      click(v, 0.09, 0.7, 1500);
      tone(v, { at: 0.02, vol: 0.15, decay: 0.15, type: 'triangle', freq: 440 });
    } else if (kind === 'scope') {
      // the tamed bird answers with a chirp
      for (const [at, f] of [[0, 2600], [0.09, 3200], [0.17, 2900]] as const) {
        tone(v, { at, vol: 0.4, attack: 0.008, decay: 0.07, freq: f, freqTo: f * 1.3 });
      }
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

  /** Menu buttons: a bamboo clapper (phách), a dry woody knock with a short hollow ring. */
  click() {
    const v = voice(HERE, 0.22, 0.12, { key: 'ui', gap: 40, important: true });
    if (!v) return;
    const p = vary(0.08);
    noise(v, { vol: 0.45, decay: 0.016, type: 'bandpass', freq: 2600 * p, q: 3 });
    tone(v, { vol: 0.75, attack: 0.001, decay: 0.06, freq: 1150 * p, freqTo: 980 * p });
    tone(v, { vol: 0.2, attack: 0.001, decay: 0.035, type: 'triangle', freq: 2350 * p });
  },

  /** Planting a map banner: a small bronze bell; taking it down plays the bell falling. */
  mark(remove = false) {
    const v = voice(HERE, 0.22, 0.5, { key: 'mark', gap: 120, important: true });
    if (!v) return;
    const [a, b] = remove ? [1568, 1046] : [1046, 1568];
    tone(v, { vol: 0.5, attack: 0.004, decay: 0.22, type: 'triangle', freq: a });
    tone(v, { at: 0.08, vol: 0.45, attack: 0.004, decay: 0.32, type: 'triangle', freq: b });
    tone(v, { at: 0.08, vol: 0.12, attack: 0.004, decay: 0.2, freq: b * 2.4 });
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

// ------------------------------------------------------------------ menu music

// A heroic Hùng Vương era march for the menus, in D minor pentatonic (D F G A C): tù và (buffalo horn)
// calls, a male chant holding open fifths, a galloping bass, đàn đá (stone lithophone), sáo trúc (bamboo
// flute) with sliding ornaments, Đông Sơn bronze drums, hand drums and cồng chiêng. Bars 0-7 are the
// "dựng nước" half; bars 8-15 the "giữ nước" half, where drums hit every beat, the bass gallops, the horn
// doubles the flute and the chords climb F-G-A into a drum roll back to the top.

const BPM = 96;
const STEP_S = 60 / BPM / 4;
const LOOP_STEPS = 16 * 16;
const TENSE_FROM_BAR = 8;
const LOOKAHEAD_S = 0.3;

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const C3 = 48, D3 = 50, F3 = 53, G3 = 55, A3 = 57;
const C4 = 60, D4 = 62, F4 = 65, G4 = 67, A4 = 69;
const C5 = 72, D5 = 74, F5 = 77, G5 = 79, A5 = 81;

/** Chord root of each bar; every instrument builds on root, fifth and octave so nothing clashes. */
const CHORD_ROOTS = [D3, D3, C3, C3, D3, D3, F3, A3, D3, D3, C3, C3, F3, F3, G3, A3];

type Phrase = [bar: number, step: number, midi: number, steps: number][];

const FLUTE: Phrase = [
  [1, 0, D5, 6], [1, 6, A4, 2], [1, 8, D5, 4], [1, 12, F5, 4],
  [2, 0, G5, 6], [2, 6, F5, 2], [2, 8, D5, 4], [2, 12, C5, 4],
  [3, 0, G4, 12], [3, 12, A4, 2], [3, 14, C5, 2],
  [4, 0, D5, 16],
  [5, 0, A4, 3], [5, 3, D5, 3], [5, 6, F5, 2], [5, 8, G5, 6], [5, 14, F5, 2],
  [6, 0, F5, 6], [6, 6, G5, 2], [6, 8, A5, 4], [6, 12, F5, 4],
  [7, 0, A4, 12], [7, 12, G4, 2], [7, 14, A4, 2],
  [9, 0, D5, 3], [9, 3, D5, 3], [9, 6, F5, 2], [9, 8, A5, 8],
  [10, 0, G5, 4], [10, 4, F5, 4], [10, 8, D5, 4], [10, 12, C5, 4],
  [11, 0, C5, 6], [11, 6, D5, 2], [11, 8, G4, 8],
  [12, 0, C5, 3], [12, 3, C5, 3], [12, 6, D5, 2], [12, 8, F5, 8],
  [13, 0, A5, 4], [13, 4, G5, 4], [13, 8, F5, 4], [13, 12, C5, 4],
  [14, 0, D5, 6], [14, 6, F5, 2], [14, 8, G5, 8],
  [15, 0, A5, 8],
];
const FLUTE_AT = new Map(FLUTE.map((n) => [n[0] * 16 + n[1], n]));

/** Tù và calls opening each phrase; in the second half the horn also doubles the flute an octave down. */
const HORN: Phrase = [
  [0, 0, D4, 6], [0, 6, A3, 2], [0, 8, D4, 8],
  [4, 0, A3, 6], [4, 6, C4, 2], [4, 8, D4, 8],
  [8, 0, D4, 3], [8, 3, D4, 3], [8, 6, F4, 2], [8, 8, A4, 8],
  ...FLUTE.filter(([bar]) => bar > TENSE_FROM_BAR).map(([bar, step, midi, len]): Phrase[number] => [bar, step, midi - 12, len]),
];
const HORN_AT = new Map(HORN.map((n) => [n[0] * 16 + n[1], n]));

/** Đàn đá figures as [step, semitones above the chord root]. */
const STONE_CALM: [number, number][] = [[0, 0], [3, 7], [6, 12], [10, 7], [12, 12]];
const STONE_TENSE: [number, number][] = [[0, 0], [2, 12], [4, 7], [6, 12], [8, 0], [10, 12], [12, 7], [14, 19]];

let musicWanted = false;
let musicOut: GainNode | null = null;
let musicMix: GainNode | null = null;
let musicSources: AudioScheduledSourceNode[] = [];
let droneFilter: BiquadFilterNode | null = null;
/** Drone oscillators with their interval above the chord root, retuned every bar. */
let droneOscs: [OscillatorNode, number][] = [];
let musicTimer = 0;
let musicStep = 0;
let musicNext = 0;
let musicHidden = false;
let fluteEndStep = -1;
let fluteMidi = 0;

/** Plays the theme on menu screens; it waits for the first user gesture before making any sound. */
export function setMenuMusic(on: boolean) {
  musicWanted = on;
  syncMusic();
}

function syncMusic() {
  const on = musicWanted && settings.music && settings.volume > 0 && !!ctx;
  if (on && !musicOut) buildMusic();
  else if (!on && musicOut) teardownMusic();
}

function buildMusic() {
  const c = ctx!;
  const out = c.createGain();
  out.gain.value = 0;
  out.gain.setTargetAtTime(1, c.currentTime, 1.5);
  out.connect(musicBus);

  // a dotted-eighth echo gives the flute and stone the feel of an open valley
  const mix = c.createGain();
  mix.connect(out);
  const echo = c.createDelay(1);
  echo.delayTime.value = STEP_S * 3;
  const echoTone = c.createBiquadFilter();
  echoTone.type = 'lowpass';
  echoTone.frequency.value = 2200;
  const feedback = c.createGain();
  feedback.gain.value = 0.3;
  const wet = c.createGain();
  wet.gain.value = 0.22;
  mix.connect(echo).connect(echoTone).connect(feedback).connect(echo);
  echoTone.connect(wet).connect(out);

  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 380;
  filter.Q.value = 2;
  const droneGain = c.createGain();
  droneGain.gain.value = 0.05;
  filter.connect(droneGain).connect(mix);
  droneOscs = [];
  for (const [interval, detune] of [[0, -5], [0, 6], [7, 0]]) {
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = hz(CHORD_ROOTS[0] - 12 + interval);
    osc.detune.value = detune;
    osc.connect(filter);
    osc.start();
    musicSources.push(osc);
    droneOscs.push([osc, interval]);
  }
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoAmt = c.createGain();
  lfoAmt.gain.value = 90;
  lfo.connect(lfoAmt).connect(filter.frequency);
  lfo.start();
  musicSources.push(lfo);

  musicOut = out;
  musicMix = mix;
  droneFilter = filter;
  musicStep = 0;
  musicNext = c.currentTime + 0.1;
  musicHidden = false;
  fluteEndStep = -1;
  scheduleMusic();
  musicTimer = window.setInterval(scheduleMusic, 60);
}

function scheduleMusic() {
  const c = ctx;
  if (!c || !musicOut) return;
  // background tabs throttle timers, so mute instead of letting the scheduler fall behind
  const hidden = document.visibilityState === 'hidden';
  if (hidden !== musicHidden) {
    musicHidden = hidden;
    musicOut.gain.setTargetAtTime(hidden ? 0 : 1, c.currentTime, 0.3);
  }
  if (hidden) return;
  if (musicNext < c.currentTime) musicNext = c.currentTime + 0.05;
  while (musicNext < c.currentTime + LOOKAHEAD_S) {
    playMusicStep(musicStep, musicNext);
    musicNext += STEP_S;
    musicStep = (musicStep + 1) % LOOP_STEPS;
  }
}

function playMusicStep(step: number, t: number) {
  const bar = Math.floor(step / 16);
  const s = step % 16;
  const tense = bar >= TENSE_FROM_BAR;
  const root = CHORD_ROOTS[bar];

  if (s === 0) {
    if (bar === 0 || bar === TENSE_FROM_BAR || bar === 12) gong(t, bar === 0 ? 0.22 : 0.28);
    if (bar === 0 || bar === TENSE_FROM_BAR) droneFilter?.frequency.setTargetAtTime(tense ? 760 : 420, t, 2);
    for (const [osc, interval] of droneOscs) osc.frequency.setTargetAtTime(hz(root - 12 + interval), t, 0.06);
    chant(t, root, 16 * STEP_S, tense ? 0.07 : 0.05);
  }

  if (!tense) {
    if (s === 0) bronzeDrum(t, 0.65);
    if (s === 8) bronzeDrum(t, 0.42);
    if (s === 4 || s === 12) handDrum(t, 0.11);
    if (s === 14) handDrum(t, 0.07);
    if (s === 0 || s === 8) bass(t, root - 12, 0.2);
  } else if (bar === 15 && s >= 8) {
    handDrum(t, 0.09 + (s - 8) * 0.03);
    if (s === 8 || s === 12 || s === 15) bronzeDrum(t, 0.5);
    if (s % 2 === 0) bass(t, root - 12, 0.16);
  } else {
    // marching beat with a heartbeat pickup, and a dum-da-da gallop in the bass
    if (s % 4 === 0) bronzeDrum(t, s === 0 ? 0.8 : 0.55);
    if (s === 3 || s === 11) bronzeDrum(t, 0.3);
    if (s % 2 === 0) handDrum(t, s % 4 === 0 ? 0.13 : 0.08);
    if (s % 4 !== 1) bass(t, root - 12, s % 4 === 0 ? 0.22 : 0.12);
  }

  for (const [at, interval] of tense ? STONE_TENSE : STONE_CALM) {
    if (at === s) stone(t, root + 12 + interval, tense ? 0.08 : 0.1);
  }

  const note = FLUTE_AT.get(step);
  if (note) {
    const [, , midi, len] = note;
    flute(t, midi, len * STEP_S, fluteEndStep === step ? fluteMidi : null, tense ? 0.1 : 0.09);
    fluteEndStep = (step + len) % LOOP_STEPS;
    fluteMidi = midi;
  }
  const call = HORN_AT.get(step);
  if (call) horn(t, call[2], call[3] * STEP_S, tense ? 0.06 : 0.075);
}

function musicVoice(t: number): Voice {
  return { c: ctx!, t, out: musicMix! };
}

/** Trống đồng: a deep skin boom with the inharmonic ring of the bronze body. */
function bronzeDrum(t: number, vol: number) {
  const v = musicVoice(t);
  tone(v, { vol, decay: 0.9, freq: 78, freqTo: 46 });
  noise(v, { vol: vol * 0.45, decay: 0.07, freq: 420 });
  for (const [f, decay] of [[183, 1.1], [291, 0.8], [437, 0.55]]) tone(v, { vol: vol * 0.07, attack: 0.004, decay, freq: f });
}

/** Tù và: a buffalo horn, lipped up into pitch with a brassy filter bloom and a late vibrato. */
function horn(t: number, midi: number, dur: number, vol: number) {
  const c = ctx!;
  const f = hz(midi);
  const end = t + dur + 0.3;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 1.5;
  lp.frequency.setValueAtTime(f * 1.5, t);
  lp.frequency.exponentialRampToValueAtTime(f * 6, t + 0.1);
  lp.frequency.exponentialRampToValueAtTime(f * 3.5, t + 0.4);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.05);
  g.gain.linearRampToValueAtTime(vol * 0.75, t + Math.max(0.06, dur * 0.9));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
  lp.connect(g).connect(musicMix!);

  const vib = c.createOscillator();
  vib.frequency.value = 4.5;
  const vibAmt = c.createGain();
  vibAmt.gain.setValueAtTime(0, t);
  vibAmt.gain.linearRampToValueAtTime(f * 0.008, t + Math.min(dur, 0.6));
  vib.connect(vibAmt);
  vib.start(t);
  vib.stop(end);
  for (const detune of [-6, 6]) {
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(f * 0.94, t);
    osc.frequency.exponentialRampToValueAtTime(f, t + 0.07);
    vibAmt.connect(osc.frequency);
    osc.connect(lp);
    osc.start(t);
    osc.stop(end);
  }
}

/** Warriors' chant on "ô": open fifth plus octave through two vowel formants. */
function chant(t: number, root: number, dur: number, vol: number) {
  const c = ctx!;
  const end = t + dur + 0.8;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.35);
  g.gain.setValueAtTime(vol, t + dur);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.7);
  g.connect(musicMix!);
  const formants = [[480, 3, 1], [820, 4, 0.6]].map(([freq, q, level]) => {
    const formant = c.createBiquadFilter();
    formant.type = 'bandpass';
    formant.frequency.value = freq;
    formant.Q.value = q;
    const fg = c.createGain();
    fg.gain.value = level;
    formant.connect(fg).connect(g);
    return formant;
  });
  for (const interval of [0, 7, 12]) {
    for (const detune of [-8, 8]) {
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = hz(root + interval);
      osc.detune.value = detune;
      for (const formant of formants) osc.connect(formant);
      osc.start(t);
      osc.stop(end);
    }
  }
}

function bass(t: number, midi: number, vol: number) {
  const v = musicVoice(t);
  const f = hz(midi);
  tone(v, { vol, decay: 0.28, type: 'triangle', freq: f });
  tone(v, { vol: vol * 0.25, decay: 0.12, type: 'sawtooth', freq: f * 2 });
}

function handDrum(t: number, vol: number) {
  const v = musicVoice(t);
  tone(v, { vol, decay: 0.16, freq: 210, freqTo: 140 });
  noise(v, { vol: vol * 0.6, decay: 0.05, type: 'bandpass', freq: 1800, q: 1.2 });
}

/** Cồng chiêng: slightly detuned partials beat against each other as the gong rings out. */
function gong(t: number, vol: number) {
  const v = musicVoice(t);
  const base = hz(D3);
  for (const [ratio, decay, level] of [[1, 4.5, 1], [1.007, 4.5, 0.8], [2.02, 3, 0.4], [2.98, 2.2, 0.25], [4.13, 1.5, 0.12]]) {
    tone(v, { vol: vol * level, attack: 0.01, decay, freq: base * ratio });
  }
  noise(v, { vol: vol * 0.3, decay: 0.15, type: 'bandpass', freq: 900, q: 0.8 });
}

/** Đàn đá: a struck stone slab, bright inharmonic overtones that die quickly. */
function stone(t: number, midi: number, vol: number) {
  const v = musicVoice(t);
  const f = hz(midi);
  tone(v, { vol, decay: 0.7, freq: f });
  tone(v, { vol: vol * 0.35, decay: 0.25, freq: f * 2.76 });
  tone(v, { vol: vol * 0.15, decay: 0.1, freq: f * 5.4 });
  noise(v, { vol: vol * 0.3, decay: 0.015, type: 'bandpass', freq: f * 4, q: 2 });
}

/** Sáo trúc: breathy and vibrato-laden; legato notes slide up or down from the previous one. */
function flute(t: number, midi: number, dur: number, slideFrom: number | null, vol: number) {
  const c = ctx!;
  const f = hz(midi);
  const osc = c.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(slideFrom === null ? f * 0.97 : hz(slideFrom), t);
  osc.frequency.exponentialRampToValueAtTime(f, t + (slideFrom === null ? 0.05 : 0.08));

  const vib = c.createOscillator();
  vib.frequency.value = 5.2;
  const vibAmt = c.createGain();
  vibAmt.gain.setValueAtTime(0, t);
  vibAmt.gain.linearRampToValueAtTime(f * 0.012, t + Math.min(dur, 0.5));
  vib.connect(vibAmt).connect(osc.frequency);

  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = f * 3;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.06);
  g.gain.linearRampToValueAtTime(vol * 0.8, t + Math.max(0.07, dur * 0.85));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.15);
  osc.connect(lp).connect(g).connect(musicMix!);

  const end = t + dur + 0.2;
  osc.start(t);
  vib.start(t);
  osc.stop(end);
  vib.stop(end);
  noise(musicVoice(t), { vol: vol * 0.25, attack: 0.04, decay: 0.12, type: 'bandpass', freq: f * 2, q: 2 });
}

function teardownMusic() {
  clearInterval(musicTimer);
  const out = musicOut;
  const sources = musicSources;
  musicOut = null;
  musicMix = null;
  droneFilter = null;
  droneOscs = [];
  musicSources = [];
  if (!out || !ctx) return;
  out.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
  setTimeout(() => {
    for (const s of sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    out.disconnect();
  }, 2500);
}
