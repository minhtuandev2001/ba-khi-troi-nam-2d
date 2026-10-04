import { ITEMS, WEAPONS, type ItemId, type MapId, type WeaponId } from '../shared';
import { onSettingsChange, settings } from '../settings';

// Every sound is synthesised with WebAudio, so the game ships no audio files.
// Mix: voices -> (distance lowpass) -> (stereo pan) -> sfx bus ─┐
//      ambience --------------------------------> ambient bus ─┤
//      menu or map theme -> (echo) ---------------> music bus ─┴-> master -> compressor -> speakers

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

  /** A knife slash cuts the air with a thin, bright "vút" and a glint of the blade; a punch is a duller rush. */
  melee(weapon: WeaponId, spot: Spot) {
    const knife = weapon === 'knife';
    const v = voice(spot, knife ? 0.5 : 0.38, 0.3, { key: 'melee', gap: 40 });
    if (!v) return;
    const p = vary();
    if (knife) {
      noise(v, { vol: 0.75, attack: 0.025, decay: 0.13, type: 'bandpass', freq: 1600 * p, freqTo: 5200, q: 2.2 });
      noise(v, { vol: 0.35, attack: 0.03, decay: 0.16, type: 'bandpass', freq: 500 * p, freqTo: 1300, q: 1 });
      tone(v, { at: 0.05, vol: 0.06, attack: 0.004, decay: 0.12, freq: 3400 * p });
      tone(v, { at: 0.05, vol: 0.04, attack: 0.004, decay: 0.09, freq: 4870 * p });
    } else {
      noise(v, { vol: 0.6, attack: 0.03, decay: 0.12, type: 'bandpass', freq: 450 * p, freqTo: 1500, q: 1.2 });
      noise(v, { vol: 0.25, decay: 0.05, type: 'bandpass', freq: 1300, q: 1 });
    }
  },

  /** Taking a weapon in hand: each one sounds like what it is made of, the knife rings as it leaves the sheath. */
  equip(weapon: WeaponId, spot: Spot, own = false) {
    const v = voice(spot, own ? 0.42 : 0.36, 0.6, { key: own ? 'equip-own' : 'equip', gap: 70, important: own });
    if (!v) return;
    const p = vary(0.06);
    switch (weapon) {
      case 'knife':
        noise(v, { vol: 0.55, attack: 0.03, decay: 0.2, type: 'bandpass', freq: 2600 * p, freqTo: 7000, q: 3 });
        for (const [f, decay, vol] of [[2900, 0.45, 0.12], [4130, 0.35, 0.08], [6020, 0.22, 0.05]] as const) {
          tone(v, { at: 0.16, vol, attack: 0.003, decay, freq: f * p });
        }
        click(v, 0.16, 0.3, 3800);
        break;
      case 'pistol':
        tone(v, { vol: 0.5, decay: 0.08, freq: 720 * p, freqTo: 620 });
        noise(v, { vol: 0.35, decay: 0.04, type: 'bandpass', freq: 1500, q: 2 });
        click(v, 0.09, 0.25, 2100);
        click(v, 0.13, 0.2, 2500);
        break;
      case 'rifle':
        noise(v, { vol: 0.4, attack: 0.03, decay: 0.12, type: 'bandpass', freq: 900, freqTo: 1500, q: 1.2 });
        click(v, 0.1, 0.4, 1000);
        twang(v, 0.14, 0.18, 196 * p, 0.12);
        break;
      case 'shotgun':
        tone(v, { vol: 0.6, decay: 0.12, freq: 150 * p, freqTo: 85 });
        noise(v, { vol: 0.5, decay: 0.07, freq: 700 });
        click(v, 0.09, 0.45, 1100);
        click(v, 0.17, 0.4, 800);
        break;
      case 'sniper':
        tone(v, { vol: 0.55, decay: 0.14, freq: 130 * p, freqTo: 75 });
        noise(v, { vol: 0.4, decay: 0.06, freq: 900 });
        click(v, 0.1, 0.4, 1300);
        tone(v, { at: 0.12, vol: 0.07, attack: 0.01, decay: 0.5, freq: 1760 });
        tone(v, { at: 0.15, vol: 0.05, attack: 0.01, decay: 0.45, freq: 2637 });
        break;
      default:
        noise(v, { vol: 0.35, attack: 0.03, decay: 0.1, type: 'bandpass', freq: 1200 * p, q: 0.8 });
    }
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

  /** Hũ lửa: the clay jar shatters, the oil catches with a deep "phừng", then the flames roar and crackle. */
  boom(spot: Spot) {
    const v = voice(spot, 0.95, 2.4, { important: spot.vol > 0.3 });
    if (!v) return;
    noise(v, { vol: 0.6, decay: 0.08, type: 'bandpass', freq: 2600, q: 1.2 });
    for (let i = 0; i < 6; i++) {
      noise(v, { at: Math.random() * 0.12, vol: 0.12 + Math.random() * 0.1, decay: 0.02, type: 'bandpass', freq: 2500 + Math.random() * 2800, q: 5 });
    }
    tone(v, { vol: 0.9, decay: 0.7, freq: 66, freqTo: 30 });
    noise(v, { vol: 0.95, attack: 0.01, decay: 1, freq: 900, freqTo: 200 });
    noise(v, { at: 0.02, vol: 0.7, attack: 0.08, decay: 0.32, freq: 220, freqTo: 1500 });
    noise(v, { at: 0.08, vol: 0.4, attack: 0.15, decay: 1.8, type: 'bandpass', freq: 520, q: 0.8 });
    for (let i = 0; i < 14; i++) {
      noise(v, { at: 0.2 + Math.random() * 1.8, vol: 0.05 + Math.random() * 0.09, decay: 0.012 + Math.random() * 0.02, type: 'highpass', freq: 2000 + Math.random() * 3000 });
    }
  },

  /** Bầu khói: the dry gourd cracks open with a puff, then the smouldering herbs hiss ("xì") as the smoke pours out. */
  smoke(spot: Spot) {
    const v = voice(spot, 0.6, 2.9, { key: 'smoke', gap: 120, important: spot.vol > 0.4 });
    if (!v) return;
    noise(v, { vol: 0.6, decay: 0.04, type: 'bandpass', freq: 1400, q: 1.5 });
    tone(v, { vol: 0.35, decay: 0.06, freq: 300, freqTo: 140 });
    noise(v, { at: 0.02, vol: 0.4, attack: 0.05, decay: 0.5, freq: 520 });
    noise(v, { at: 0.04, vol: 0.55, attack: 0.08, decay: 2.5, type: 'highpass', freq: 3600, freqTo: 2400 });
    noise(v, { at: 0.06, vol: 0.25, attack: 0.1, decay: 1.7, type: 'bandpass', freq: 6200, q: 1.5 });
  },

  /** Reloading, spread over the weapon's reload time so the last tick lands as it becomes ready. */
  reload(weapon: WeaponId, spot: Spot) {
    const len = Math.max(0.8, (WEAPONS[weapon]?.reloadMs ?? 0) / 1000);
    const v = voice(spot, 0.55, len + 0.3, { key: 'reload', gap: 150 });
    if (!v) return;
    const end = len - 0.15;
    switch (weapon) {
      // ống thổi: a pouch of bamboo darts, a few slipped into the tube, a knock to seat them
      case 'pistol':
        noise(v, { vol: 0.3, attack: 0.04, decay: 0.16, type: 'bandpass', freq: 2200, freqTo: 3800, q: 1.4 });
        for (const at of [0.35, 0.6, 0.85]) click(v, at, 0.35, 1800 * vary(0.1));
        tone(v, { at: end, vol: 0.4, decay: 0.07, freq: 640, freqTo: 560 });
        click(v, end, 0.3, 1500);
        break;
      // nỏ: the crank ratchets the prod back, a heavy latch, bolts laid in the groove, the lock clacks shut
      case 'shotgun':
        for (let i = 0; i < 10; i++) click(v, 0.3 + i * 0.075, 0.28, 900 + i * 45);
        noise(v, { at: 1.15, vol: 0.5, decay: 0.07, type: 'bandpass', freq: 900, q: 1.2 });
        tone(v, { at: 1.15, vol: 0.4, decay: 0.1, freq: 140, freqTo: 80 });
        click(v, 1.6, 0.35, 1300);
        click(v, 1.9, 0.35, 1200);
        noise(v, { at: end, vol: 0.45, decay: 0.06, type: 'bandpass', freq: 1100, q: 1.5 });
        tone(v, { at: end, vol: 0.35, decay: 0.08, freq: 170, freqTo: 100 });
        break;
      // thần tiễn: a long creaking draw, a bronze-tipped arrow touching the rest, and a shimmer once it is nocked
      case 'sniper':
        noise(v, { vol: 0.3, attack: 0.05, decay: 0.2, type: 'bandpass', freq: 1400, freqTo: 3200, q: 1.2 });
        tone(v, { at: 0.5, vol: 0.12, attack: 0.25, decay: 0.5, type: 'triangle', freq: 95, freqTo: 120 });
        tone(v, { at: 1, vol: 0.08, attack: 0.004, decay: 0.45, freq: 1760 });
        click(v, 1.8, 0.45, 1100);
        tone(v, { at: 2.2, vol: 0.12, attack: 0.1, decay: 0.3, type: 'triangle', freq: 150, freqTo: 210 });
        click(v, end, 0.45, 900);
        tone(v, { at: end, vol: 0.06, attack: 0.01, decay: 0.5, freq: 1318 });
        tone(v, { at: end + 0.03, vol: 0.05, attack: 0.01, decay: 0.45, freq: 1760 });
        break;
      // cung tên: arrows rattle out of the quiver, one is nocked with a wooden tick and the string eased back
      default:
        noise(v, { vol: 0.3, attack: 0.05, decay: 0.18, type: 'bandpass', freq: 1400, freqTo: 3200, q: 1.2 });
        for (const at of [0.3, 0.42, 0.55]) click(v, at, 0.3, 1300 * vary(0.15));
        click(v, len * 0.6, 0.5, 1200);
        tone(v, { at: len * 0.6 + 0.1, vol: 0.14, attack: 0.08, decay: 0.2, type: 'triangle', freq: 180, freqTo: 240 });
        click(v, end, 0.45, 900);
        twang(v, end + 0.04, 0.1, 196, 0.1);
    }
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

  /** A wind-up rustle, the arm's swing, then the jar or gourd whirring away end over end. */
  throwItem(spot: Spot) {
    const v = voice(spot, 0.45, 0.6, { key: 'throw', gap: 80 });
    if (!v) return;
    const p = vary();
    noise(v, { vol: 0.3, attack: 0.03, decay: 0.08, type: 'bandpass', freq: 1100 * p, q: 0.8 });
    noise(v, { at: 0.06, vol: 0.65, attack: 0.06, decay: 0.16, type: 'bandpass', freq: 320 * p, freqTo: 1700, q: 1.1 });
    for (const [at, vol, f] of [[0.2, 0.3, 1300], [0.29, 0.22, 1150], [0.38, 0.15, 1000], [0.47, 0.09, 900]] as const) {
      noise(v, { at, vol, attack: 0.025, decay: 0.05, type: 'bandpass', freq: f * p, q: 1.6 });
    }
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

/** A looping piece: `play` schedules one sixteenth-note step at audio time `t`. */
interface Track {
  stepS: number;
  steps: number;
  /** Gain on the music bus; match themes sit above the menu theme so they carry over the fighting. */
  level: number;
  echoSteps: number;
  firstRoot: number;
  droneCutoff: number;
  /** Match themes get a held string pad whose dissonant notes grow with the tension. */
  pad: boolean;
  reset(): void;
  play(step: number, t: number): void;
}

/** How tense the match is: 0 exploring, 1 fighting nearby or the zone closing in, 2 the final moments. */
export type MusicTension = 0 | 1 | 2;

let menuWanted = false;
let tensionWanted: MusicTension = 0;
/** Extra loudness on top of the track's level, raised with the tension. */
let musicBoost = 1;
/** Pad oscillators with their interval above the bar's root. */
let padVoices: { osc: OscillatorNode; gain: GainNode; interval: number }[] = [];
let matchMap: MapId | null = null;
let musicTrack: Track | null = null;
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

const MENU_TRACK: Track = {
  stepS: STEP_S,
  steps: LOOP_STEPS,
  level: 1,
  echoSteps: 3,
  firstRoot: CHORD_ROOTS[0],
  droneCutoff: 380,
  pad: false,
  reset: () => {
    fluteEndStep = -1;
  },
  play: (step, t) => playMenuStep(step, t),
};

/** Plays the theme on menu screens; it waits for the first user gesture before making any sound. */
export function setMenuMusic(on: boolean) {
  menuWanted = on;
  syncMusic();
}

/** In a match: the map's own theme, which takes over from the menu theme; `null` when the match ends. */
export function setMatchMusic(map: MapId | null) {
  matchMap = map;
  if (!map) tensionWanted = 0;
  syncMusic();
}

/** The match theme follows the fight; a change is picked up at the start of the next bar. */
export function setMusicTension(level: MusicTension) {
  tensionWanted = level;
}

function wantedTrack(): Track | null {
  if (!settings.music || settings.volume <= 0 || !ctx) return null;
  if (matchMap) return themeTrack(matchMap);
  return menuWanted ? MENU_TRACK : null;
}

function syncMusic() {
  const want = wantedTrack();
  if (want === musicTrack) return;
  if (musicTrack) teardownMusic();
  if (want) buildMusic(want);
}

function buildMusic(track: Track) {
  const c = ctx!;
  const out = c.createGain();
  out.gain.value = 0;
  out.gain.setTargetAtTime(track.level, c.currentTime, 1.5);
  out.connect(musicBus);

  // a dotted-eighth echo gives the flute and stone the feel of an open valley
  const mix = c.createGain();
  mix.connect(out);
  const echo = c.createDelay(1);
  echo.delayTime.value = Math.min(0.95, track.stepS * track.echoSteps);
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
  filter.frequency.value = track.droneCutoff;
  filter.Q.value = 2;
  const droneGain = c.createGain();
  droneGain.gain.value = 0.05;
  filter.connect(droneGain).connect(mix);
  droneOscs = [];
  for (const [interval, detune] of [[0, -5], [0, 6], [7, 0]]) {
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = hz(track.firstRoot - 12 + interval);
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

  padVoices = [];
  if (track.pad) {
    // bowed-string pad breathing slowly in and out; its gains are set every bar from the tension
    const padTone = c.createBiquadFilter();
    padTone.type = 'lowpass';
    padTone.frequency.value = 1100;
    const breath = c.createGain();
    const breathLfo = c.createOscillator();
    breathLfo.frequency.value = 0.18;
    const breathAmt = c.createGain();
    breathAmt.gain.value = 0.35;
    breathLfo.connect(breathAmt).connect(breath.gain);
    breathLfo.start();
    musicSources.push(breathLfo);
    padTone.connect(breath).connect(mix);
    for (const interval of PAD_INTERVALS) {
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc.detune.value = interval === 0 ? -4 : 4;
      osc.frequency.value = hz(track.firstRoot + 12 + interval);
      const gain = c.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(padTone);
      osc.start();
      musicSources.push(osc);
      padVoices.push({ osc, gain, interval });
    }
  }

  musicTrack = track;
  musicBoost = 1;
  musicOut = out;
  musicMix = mix;
  droneFilter = filter;
  musicStep = 0;
  musicNext = c.currentTime + 0.1;
  musicHidden = false;
  track.reset();
  scheduleMusic();
  musicTimer = window.setInterval(scheduleMusic, 60);
}

function scheduleMusic() {
  const c = ctx;
  const track = musicTrack;
  if (!c || !musicOut || !track) return;
  // background tabs throttle timers, so mute instead of letting the scheduler fall behind
  const hidden = document.visibilityState === 'hidden';
  if (hidden !== musicHidden) {
    musicHidden = hidden;
    musicOut.gain.setTargetAtTime(hidden ? 0 : track.level * musicBoost, c.currentTime, 0.3);
  }
  if (hidden) return;
  if (musicNext < c.currentTime) musicNext = c.currentTime + 0.05;
  while (musicNext < c.currentTime + LOOKAHEAD_S) {
    track.play(musicStep, musicNext);
    musicNext += track.stepS;
    musicStep = (musicStep + 1) % track.steps;
  }
}

function retuneDrone(root: number, t: number) {
  for (const [osc, interval] of droneOscs) osc.frequency.setTargetAtTime(hz(root - 12 + interval), t, 0.06);
}

function playMenuStep(step: number, t: number) {
  const bar = Math.floor(step / 16);
  const s = step % 16;
  const tense = bar >= TENSE_FROM_BAR;
  const root = CHORD_ROOTS[bar];

  if (s === 0) {
    if (bar === 0 || bar === TENSE_FROM_BAR || bar === 12) gong(t, bar === 0 ? 0.22 : 0.28);
    if (bar === 0 || bar === TENSE_FROM_BAR) droneFilter?.frequency.setTargetAtTime(tense ? 760 : 420, t, 2);
    retuneDrone(root, t);
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
function gong(t: number, vol: number, midi = D3) {
  const v = musicVoice(t);
  const base = hz(midi);
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
  musicTrack = null;
  musicOut = null;
  musicMix = null;
  droneFilter = null;
  droneOscs = [];
  padVoices = [];
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

/** Mõ: a hollow wooden knock. */
function woodblock(t: number, vol: number) {
  const v = musicVoice(t);
  tone(v, { vol, decay: 0.05, freq: 880, freqTo: 820 });
  noise(v, { vol: vol * 0.5, decay: 0.012, type: 'bandpass', freq: 2400, q: 3 });
}

/** Sênh tiền: coins strung on wooden clappers, a short metallic shimmer. */
function shaker(t: number, vol: number) {
  const v = musicVoice(t);
  noise(v, { vol, attack: 0.004, decay: 0.045, type: 'highpass', freq: 6500 });
  noise(v, { vol: vol * 0.5, decay: 0.03, type: 'bandpass', freq: 9000, q: 4 });
}

/** Đàn tranh: a plucked zither string, bright at first and quickly mellowing. */
function pluck(t: number, midi: number, vol: number) {
  const v = musicVoice(t);
  const f = hz(midi);
  tone(v, { vol, decay: 0.6, type: 'triangle', freq: f });
  tone(v, { vol: vol * 0.4, decay: 0.25, freq: f * 2 });
  tone(v, { vol: vol * 0.15, decay: 0.12, freq: f * 3 });
  noise(v, { vol: vol * 0.35, decay: 0.012, type: 'bandpass', freq: f * 4, q: 2 });
}

let monochordWave: PeriodicWave | null = null;

/** Đàn bầu: the monochord's pure harmonic tone, bent up into each note and swaying with a wide vibrato. */
function monochord(t: number, midi: number, dur: number, slideFrom: number | null, vol: number) {
  const c = ctx!;
  const f = hz(midi);
  monochordWave ??= c.createPeriodicWave(new Float32Array([0, 0, 0, 0]), new Float32Array([0, 1, 0.35, 0.12]));
  const osc = c.createOscillator();
  osc.setPeriodicWave(monochordWave);
  osc.frequency.setValueAtTime(slideFrom === null ? hz(midi - 2) : hz(slideFrom), t);
  osc.frequency.exponentialRampToValueAtTime(f, t + 0.12);

  const vib = c.createOscillator();
  vib.frequency.value = 5;
  const vibAmt = c.createGain();
  vibAmt.gain.setValueAtTime(0, t);
  vibAmt.gain.linearRampToValueAtTime(f * 0.018, t + Math.min(dur, 0.45));
  vib.connect(vibAmt).connect(osc.frequency);

  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(vol * 0.4, t + Math.max(0.05, dur));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.3);
  osc.connect(g).connect(musicMix!);

  const end = t + dur + 0.35;
  osc.start(t);
  vib.start(t);
  osc.stop(end);
  vib.stop(end);
}

// ------------------------------------------------------------------ match themes

// Each map has its own 16-bar theme. Unlike the heroic menu march (chant, open fifths), match themes are dark and
// suspenseful, and follow the fight (`setMusicTension`, applied at the next bar):
//   0 exploring: the calm rhythm, the melody a little softer, a low string pad with a faint minor sixth.
//   1 fighting nearby or the zone closing: the driving rhythm, a clock-like tick, a noise riser every 4 bars.
//   2 the final moments: a racing heartbeat, a bass rocking root to minor second, a trembling đàn tranh,
//     the pad's semitone cluster and a gong-and-drum stinger on the way in.
// Rhythms are written one character per sixteenth note ('.' = rest; drums take a loudness 1-9; bass, đàn tranh and
// đàn đá take an interval over the bar's root: 0 or x root, m minor second, 5 fifth, 8 or o octave, a twelfth,
// b two octaves), melodies as "note:sixteenths" with "|" between bars, so every part stays on the chord of its bar.

type LineVoice = 'flute' | 'horn' | 'monochord' | 'pluck';

interface Line {
  voice: LineVoice;
  vol: number;
  notes: Phrase;
}

interface Section {
  drum?: string;
  hand?: string;
  wood?: string;
  shaker?: string;
  bass?: string;
  pluck?: string;
  stone?: string;
}

interface Theme {
  bpm: number;
  roots: string;
  /** Rhythm while exploring (tension 0) and while fighting (tension 1 and 2). */
  calm: Section;
  tense: Section;
  lines: Line[];
  gongBars: number[];
  gong: string;
  /** Drone brightness (lowpass cutoff) while exploring and while fighting. */
  drone: [number, number];
  level: number;
}

/** Pad notes over the bar's root: root, fifth, minor sixth and minor second, the last two rising with the tension. */
const PAD_INTERVALS = [0, 7, 8, 1];
const PAD_LEVELS: Record<MusicTension, number[]> = {
  0: [0.022, 0.016, 0.006, 0],
  1: [0.026, 0.02, 0.016, 0.004],
  2: [0.03, 0.022, 0.02, 0.016],
};
/** Tension 2 bass: root, root, root, minor second, rocking like a held breath. */
const DREAD_BASS = 'x.x.x.m.x.x.x.m.';

function setPad(root: number, tension: MusicTension, t: number) {
  padVoices.forEach(({ osc, gain, interval }, i) => {
    osc.frequency.setTargetAtTime(hz(root + 12 + interval), t, 0.08);
    gain.gain.setTargetAtTime(PAD_LEVELS[tension][i], t, 0.8);
  });
}

/** Two low thumps, "lub-dub". */
function heartbeat(t: number, vol: number) {
  const v = musicVoice(t);
  tone(v, { vol, decay: 0.16, freq: 64, freqTo: 40 });
  tone(v, { at: 0.17, vol: vol * 0.7, decay: 0.2, freq: 58, freqTo: 36 });
}

/** A dry clock tick. */
function tick(t: number, vol: number) {
  const v = musicVoice(t);
  tone(v, { vol, decay: 0.02, type: 'triangle', freq: 1900 });
  noise(v, { vol: vol * 0.6, decay: 0.01, type: 'bandpass', freq: 3600, q: 4 });
}

/** Rushing air that swells through a bar and cuts off at the next downbeat. */
function riser(t: number, dur: number, vol: number) {
  const v = musicVoice(t);
  noise(v, { vol, attack: dur, decay: 0.06, type: 'bandpass', freq: 300, freqTo: 4000, q: 1.4 });
  tone(v, { vol: vol * 0.25, attack: dur, decay: 0.06, freq: 220, freqTo: 880 });
}

/** Entering the final moments: a gong an octave under the bar's root over a heavy drum hit. */
function stinger(t: number, root: number) {
  bronzeDrum(t, 0.95);
  gong(t, 0.34, root - 12);
  noise(musicVoice(t), { vol: 0.35, attack: 0.01, decay: 0.9, freq: 600, freqTo: 120 });
}

const NOTE_BASE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function midiOf(name: string): number {
  const m = /^([A-G])([#b]?)(\d)$/.exec(name);
  if (!m) throw new Error(`audio: bad note "${name}"`);
  return 12 * (Number(m[3]) + 1) + NOTE_BASE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

function mel(firstBar: number, text: string): Phrase {
  const out: Phrase = [];
  text.split('|').forEach((bar, i) => {
    let step = 0;
    for (const token of bar.trim().split(/\s+/).filter(Boolean)) {
      const [name, len = '4'] = token.split(':');
      if (name !== '-') out.push([firstBar + i, step, midiOf(name), Number(len)]);
      step += Number(len);
    }
  });
  return out;
}

const shift = (phrase: Phrase, semitones: number): Phrase => phrase.map(([bar, step, midi, len]) => [bar, step, midi + semitones, len]);

const INTERVAL: Record<string, number> = { x: 0, '0': 0, m: 1, '5': 7, '8': 12, o: 12, a: 19, b: 24 };
const level = (pattern: string | undefined, s: number) => Number(pattern?.[s]) / 9 || 0;
const interval = (pattern: string | undefined, s: number): number | null => INTERVAL[pattern?.[s] ?? '.'] ?? null;

function playLine(voice: LineVoice, t: number, midi: number, dur: number, slideFrom: number | null, vol: number) {
  if (voice === 'flute') flute(t, midi, dur, slideFrom, vol);
  else if (voice === 'horn') horn(t, midi, dur, vol);
  else if (voice === 'monochord') monochord(t, midi, dur, slideFrom, vol);
  else pluck(t, midi, vol);
}

function buildTheme(def: Theme): Track {
  const roots = def.roots.trim().split(/\s+/).map(midiOf);
  const stepS = 60 / def.bpm / 4;
  const steps = roots.length * 16;
  const gongMidi = midiOf(def.gong);
  const lines = def.lines.map((l) => ({ ...l, at: new Map(l.notes.map((n) => [n[0] * 16 + n[1], n])), endStep: -1, lastMidi: 0 }));
  let tension: MusicTension = 0;
  return {
    stepS,
    steps,
    level: def.level,
    echoSteps: 3,
    firstRoot: roots[0],
    droneCutoff: def.drone[0],
    pad: true,
    reset() {
      for (const l of lines) l.endStep = -1;
      tension = tensionWanted;
    },
    play(step, t) {
      const bar = Math.floor(step / 16);
      const s = step % 16;
      const root = roots[bar];
      if (s === 0) {
        const before = tension;
        tension = tensionWanted;
        if (tension !== before || step === 0) {
          droneFilter?.frequency.setTargetAtTime(def.drone[tension > 0 ? 1 : 0] + (tension === 2 ? 250 : 0), t, 1.5);
          musicBoost = 1 + 0.12 * tension;
          musicOut?.gain.setTargetAtTime(def.level * musicBoost, t, 1.2);
        }
        if (tension === 2 && before < 2) stinger(t, root);
        else if (def.gongBars.includes(bar)) gong(t, bar === 0 ? 0.22 : 0.28, gongMidi);
        retuneDrone(root, t);
        setPad(root, tension, t);
        if (tension > 0 && bar % 4 === 3) riser(t, 16 * stepS, tension === 2 ? 0.1 : 0.06);
      }
      const sec = tension > 0 ? def.tense : def.calm;
      if (bar === roots.length - 1 && s >= 8) {
        handDrum(t, 0.09 + (s - 8) * 0.03);
        if (s === 8 || s === 12 || s === 15) bronzeDrum(t, 0.55);
      } else {
        if (level(sec.drum, s)) bronzeDrum(t, level(sec.drum, s) * 0.85);
        if (level(sec.hand, s)) handDrum(t, level(sec.hand, s) * 0.4);
      }
      if (level(sec.wood, s)) woodblock(t, level(sec.wood, s) * 0.3);
      if (level(sec.shaker, s)) shaker(t, level(sec.shaker, s) * 0.22);
      if (tension === 1 && s % 4 === 2) tick(t, 0.1);
      if (tension === 2) {
        if (s % 2 === 0) tick(t, s % 4 === 0 ? 0.13 : 0.08);
        if (s % 4 === 0) heartbeat(t, 0.45);
        // the đàn tranh trembles on a high root, slipping up a semitone at the end of each bar
        pluck(t, root + 24 + (s >= 12 ? 1 : 0), 0.03);
      }
      const b = interval(tension === 2 ? DREAD_BASS : sec.bass, s);
      if (b !== null) bass(t, root - 12 + b, b === 0 ? 0.22 : 0.17);
      const p = tension === 2 ? null : interval(sec.pluck, s);
      if (p !== null) pluck(t, root + 12 + p, tension > 0 ? 0.07 : 0.085);
      const st = interval(sec.stone, s);
      if (st !== null) stone(t, root + 12 + st, 0.09);
      for (const l of lines) {
        const note = l.at.get(step);
        if (!note) continue;
        const [, , midi, len] = note;
        playLine(l.voice, t, midi, len * stepS, l.endStep === step ? l.lastMidi : null, l.vol * (tension === 0 ? 0.8 : 1));
        l.endStep = (step + len) % steps;
        l.lastMidi = midi;
      }
    },
  };
}

const THEMES: Record<MapId, () => Theme> = {
  // Nước Văn Lang: a war brewing over the whole realm, in C minor (far from the menu's D) with low horn calls
  // that lean on the minor second, a 3-3-2 drum gallop and a flute that ends each half on the dominant
  vanlang: () => ({
    bpm: 104,
    roots: 'C3 C3 Ab2 Ab2 C3 C3 G2 G2 Eb3 Eb3 F3 G2 Ab2 Ab2 F2 G2',
    calm: { drum: '8.....5...8.....', hand: '..2...3...2...3.', bass: 'x..x....x..x....', pluck: '0...5.8.0...5.8a' },
    tense: { drum: '9..6..6.9..6.36.', hand: '3.23.23.3.23.232', shaker: '.2.2.2.2.2.2.2.2', bass: 'x.ox.ox.x.ox.oxo', pluck: '058a058a058a8a58' },
    lines: [
      { voice: 'horn', vol: 0.075, notes: [...mel(0, 'C4:8 G3:4 Bb3:4'), ...mel(4, 'C4:6 Eb4:2 C4:8'), ...mel(8, 'Eb4:4 Eb4:2 E4:2 Eb4:8'), ...mel(12, 'C4:4 C4:2 Db4:2 C4:8')] },
      {
        voice: 'flute',
        vol: 0.1,
        notes: [
          ...mel(1, 'G4:6 Bb4:2 C5:8 | Eb5:4 C5:4 Ab4:8 | C5:6 Bb4:2 Ab4:4 F4:4'),
          ...mel(5, 'Eb5:4 F5:4 G5:8 | F5:4 Eb5:4 D5:8 | G4:16'),
          ...mel(9, 'G5:4 Ab5:4 G5:4 Eb5:4 | F5:6 Eb5:2 C5:8 | D5:8 F5:4 G5:4'),
          ...mel(13, 'C6:4 Bb5:4 Ab5:4 G5:4 | F5:4 Ab5:4 C6:8 | B4:8 D5:4 G5:4'),
        ],
      },
      { voice: 'monochord', vol: 0.07, notes: [...mel(9, 'Eb4:16 | C4:16 | B3:16'), ...mel(13, 'Eb4:16 | C4:16 | D4:16')] },
    ],
    gongBars: [0, 8],
    gong: 'C3',
    drone: [380, 780],
    level: 1.4,
  }),
  // Thành Cổ Loa: the spiral citadel of the magic crossbow, tense and quick, đàn tranh ticking like a ratchet
  coloa: () => ({
    bpm: 124,
    roots: 'E3 E3 D3 D3 E3 E3 G3 B2 E3 G3 A3 B2 E3 D3 G3 B2',
    calm: { drum: '9.....6.9.......', hand: '..2...2...2...2.', wood: '....4.......4...', bass: 'x..x..x.x..x..x.', pluck: '0.8.5.8.0.8.5.8.' },
    tense: { drum: '9..69..69..69.6.', hand: '3.2.3.223.2.3.22', shaker: '.3.3.3.3.3.3.3.3', bass: 'x.xxx.xxx.xxx.xo', pluck: '08580858085808a8' },
    lines: [
      { voice: 'horn', vol: 0.07, notes: [...mel(0, 'E4:3 E4:3 G4:2 B4:8'), ...mel(4, 'E4:3 E4:3 D4:2 B3:8'), ...mel(8, 'E4:2 E4:2 E4:2 G4:2 B4:8'), ...mel(12, 'E4:2 E4:2 E4:2 G4:2 D5:8')] },
      {
        voice: 'flute',
        vol: 0.1,
        notes: [
          ...mel(1, 'E5:2 E5:2 G5:2 E5:2 B5:4 A5:4 | G5:4 E5:4 D5:8 | B4:2 D5:2 E5:4 D5:4 B4:4'),
          ...mel(5, 'E5:2 G5:2 A5:4 B5:4 D6:4 | B5:4 A5:4 G5:4 E5:4 | B4:12 D5:4'),
          ...mel(9, 'E6:2 D6:2 B5:4 A5:2 B5:2 G5:4 | A5:4 B5:4 D6:4 B5:4 | A5:8 G5:4 E5:4'),
          ...mel(13, 'E5:2 G5:2 B5:2 E6:2 D6:4 B5:4 | D6:4 B5:4 A5:4 G5:4 | B5:8 -:8'),
        ],
      },
    ],
    gongBars: [0, 8],
    gong: 'E3',
    drone: [480, 900],
    level: 1.35,
  }),
  // Núi Nghĩa Lĩnh: the sacred mountain of the Hùng temple, slow and misty, đàn bầu and gongs over a deep pulse
  nghialinh: () => ({
    bpm: 80,
    roots: 'A2 A2 D3 D3 C3 C3 E3 E3 A2 C3 D3 E3 A2 G2 E3 E3',
    calm: { drum: '7...............', hand: '........3.......', bass: 'x...............', stone: '0...8...5...a...' },
    tense: { drum: '8.......6...5...', hand: '..2...3...2...3.', bass: 'x.......x...x...', stone: '0.8.5.8.0.8.a.8.' },
    lines: [
      {
        voice: 'monochord',
        vol: 0.11,
        notes: mel(0, 'A4:8 C5:4 D5:4 | E5:12 D5:4 | D5:8 C5:4 A4:4 | A4:16 | C5:6 D5:2 E5:8 | G5:8 E5:4 D5:4 | E5:16 | -:8 D5:4 C5:4'),
      },
      { voice: 'horn', vol: 0.05, notes: [...mel(0, 'A3:12 -:4'), ...mel(4, 'G3:12 -:4')] },
      {
        voice: 'flute',
        vol: 0.09,
        notes: mel(8, 'A5:4 G5:4 E5:4 D5:4 | E5:8 G5:8 | A5:6 G5:2 E5:4 D5:4 | E5:16 | C6:4 A5:4 G5:4 E5:4 | D5:8 E5:4 G5:4 | A5:16 | G5:8 E5:8'),
      },
      { voice: 'monochord', vol: 0.07, notes: mel(8, 'E4:16 | G4:16 | A4:16 | B4:16 | E4:16 | D4:16 | E4:16 | B3:16') },
    ],
    gongBars: [0, 4, 8, 12],
    gong: 'A2',
    drone: [320, 600],
    level: 1.3,
  }),
  // Làng Lạc Việt: a village festival, dancing flute and đàn tranh over mõ, sênh tiền and hand drums
  lacviet: () => ({
    bpm: 112,
    roots: 'G3 G3 D3 E3 G3 C3 D3 D3 E3 E3 C3 D3 G3 C3 D3 G3',
    calm: { drum: '7.......5.......', hand: '...2..3....2.3..', wood: '..3...3...3...3.', bass: 'x...o...x...o...', pluck: '0.5.8.5.a.8.5.8.' },
    tense: { drum: '8...6...8...6.5.', hand: '.2.3.2.3.2.3.233', wood: '3.3.3.3.3.3.3.3.', shaker: '2222222222222222', bass: 'x.o.x.o.x.o.x.oo', pluck: '058a058a058a8a58' },
    lines: [
      {
        voice: 'flute',
        vol: 0.1,
        notes: [
          ...mel(0, 'D5:2 E5:2 G5:4 E5:2 D5:2 B4:4 | A4:2 B4:2 D5:4 B4:4 A4:4 | D5:4 A4:2 B4:2 D5:4 E5:4 | B4:8 A4:4 G4:4'),
          ...mel(4, 'G5:2 E5:2 D5:4 E5:2 G5:2 A5:4 | G5:4 E5:4 D5:4 B4:4 | A4:4 B4:2 D5:2 E5:4 D5:4 | D5:12 -:4'),
          ...mel(8, 'E5:2 G5:2 A5:2 B5:2 A5:4 G5:4 | E5:4 D5:2 E5:2 G5:8 | E5:2 D5:2 B4:4 D5:2 E5:2 G5:4 | A5:8 B5:4 A5:4'),
          ...mel(12, 'D6:2 B5:2 A5:4 G5:2 E5:2 D5:4 | E5:4 G5:4 E5:4 D5:4 | B4:2 D5:2 E5:4 A5:4 B5:4 | G5:8 -:8'),
        ],
      },
      { voice: 'monochord', vol: 0.065, notes: mel(8, 'G4:8 B4:8 | E4:8 G4:8 | C4:8 E4:8 | D4:8 A4:8 | G4:8 B4:8 | E4:8 G4:8 | D4:8 A4:8 | G4:16') },
    ],
    gongBars: [0, 8],
    gong: 'G2',
    drone: [520, 760],
    level: 1.3,
  }),
  // Kinh Đô Phong Châu: the royal capital, a stately court fanfare with đàn đá, bronze drums and gongs
  phongchau: () => {
    const flute = mel(8, 'F5:4 A5:4 C6:6 A5:2 | D6:4 C6:4 A5:8 | G5:2 A5:2 C6:4 D6:4 C6:4 | C6:12 A5:4 | A5:4 C6:4 D6:4 F6:4 | D6:4 C6:4 A5:4 G5:4 | A5:4 G5:4 F5:4 G5:4 | C6:8 -:8');
    return {
      bpm: 92,
      roots: 'F3 F3 C3 C3 D3 D3 C3 C3 F3 D3 G3 C3 F3 D3 C3 C3',
      calm: { drum: '9.......6...6...', hand: '....3.......3...', bass: 'x.......x.......', stone: '0...5...8...5...' },
      tense: { drum: '9...7...9..57...', hand: '2.3.2.3.2.3.2.33', bass: 'x...x.o.x...x.o.', stone: '0.5.8.5.a.8.5.8.' },
      lines: [
        {
          voice: 'horn',
          vol: 0.08,
          notes: mel(0, 'F4:4 A4:4 C5:8 | D5:4 C5:4 A4:8 | G4:4 A4:4 C5:4 G4:4 | C5:16 | D5:4 C5:4 A4:4 G4:4 | A4:6 G4:2 F4:8 | G4:4 A4:4 C5:4 D5:4 | C5:16'),
        },
        { voice: 'flute', vol: 0.1, notes: flute },
        { voice: 'horn', vol: 0.055, notes: shift(flute, -12) },
      ],
      gongBars: [0, 4, 8, 12],
      gong: 'F2',
      drone: [420, 760],
      level: 1.35,
    };
  },
  // Trường Tập Bắn: a light, steady groove to aim to, đàn tranh first and the flute after
  truongban: () => ({
    bpm: 100,
    roots: 'C3 C3 A2 A2 G2 G2 C3 C3 C3 C3 A2 A2 D3 D3 G2 G2',
    calm: { drum: '6.......4.......', hand: '....2.......2...', wood: '..2...2...2...2.', bass: 'x.......o.......' },
    tense: { drum: '7...5...7...5...', hand: '..2...2...2...22', shaker: '.2.2.2.2.2.2.2.2', bass: 'x...o...x...o...', stone: '0...8...5...8...' },
    lines: [
      {
        voice: 'pluck',
        vol: 0.1,
        notes: mel(0, 'C5:2 E5:2 G5:4 E5:4 D5:4 | C5:8 -:8 | A4:2 C5:2 E5:4 D5:4 C5:4 | A4:8 -:8 | G4:2 A4:2 C5:4 D5:4 E5:4 | D5:8 -:8 | E5:2 G5:2 A5:4 G5:4 E5:4 | C5:8 -:8'),
      },
      {
        voice: 'flute',
        vol: 0.085,
        notes: mel(8, 'G5:4 E5:4 D5:4 C5:4 | D5:8 E5:8 | A5:4 G5:4 E5:4 D5:4 | E5:16 | D5:4 E5:4 G5:4 A5:4 | G5:8 E5:8 | D5:4 E5:2 D5:2 C5:4 A4:4 | G4:8 -:8'),
      },
    ],
    gongBars: [0],
    gong: 'C3',
    drone: [380, 560],
    level: 1.2,
  }),
};

const themeCache = new Map<MapId, Track>();

function themeTrack(map: MapId): Track {
  let track = themeCache.get(map);
  if (!track) {
    track = buildTheme(THEMES[map]());
    themeCache.set(map, track);
  }
  return track;
}
