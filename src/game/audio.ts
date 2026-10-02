import type { WeaponId } from '../shared';
import { settings } from '../settings';

let ctx: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (!settings.sfx || settings.volume <= 0) return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Browsers only allow audio after a user gesture. */
export function unlockAudio() {
  audio();
}

function gainNode(c: AudioContext, volume: number, decay: number): GainNode {
  const g = c.createGain();
  const v = Math.max(0.0001, volume * settings.volume);
  g.gain.setValueAtTime(v, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + decay);
  g.connect(c.destination);
  return g;
}

function noise(volume: number, decay: number, freq: number, type: BiquadFilterType = 'lowpass') {
  const c = audio();
  if (!c || !noiseBuffer || volume < 0.01) return;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = c.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  src.connect(filter).connect(gainNode(c, volume, decay));
  src.start();
  src.stop(c.currentTime + decay + 0.05);
}

function tone(volume: number, decay: number, from: number, to: number, type: OscillatorType = 'square') {
  const c = audio();
  if (!c || volume < 0.01) return;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), c.currentTime + decay);
  osc.connect(gainNode(c, volume, decay));
  osc.start();
  osc.stop(c.currentTime + decay + 0.05);
}

/** Volume falloff by distance from the listener. */
export function falloff(distance: number): number {
  return Math.max(0, 1 - distance / 1600);
}

const GUN_SOUND: Record<string, [number, number, number]> = {
  pistol: [0.35, 0.12, 2400],
  rifle: [0.4, 0.14, 1800],
  shotgun: [0.6, 0.3, 1100],
  sniper: [0.75, 0.45, 900],
};

export const sfx = {
  shot(weapon: WeaponId, vol: number) {
    const s = GUN_SOUND[weapon];
    if (!s) return;
    noise(s[0] * vol, s[1], s[2]);
    tone(0.12 * vol, 0.08, 180, 60);
  },
  melee(vol: number) {
    noise(0.15 * vol, 0.1, 3000, 'bandpass');
  },
  hit(vol: number) {
    tone(0.15 * vol, 0.06, 900, 400, 'triangle');
  },
  hurt() {
    tone(0.25, 0.15, 220, 90, 'sawtooth');
  },
  boom(vol: number) {
    noise(0.9 * vol, 0.9, 500);
    tone(0.5 * vol, 0.6, 90, 30, 'sine');
  },
  reload(vol: number) {
    tone(0.12 * vol, 0.05, 1400, 1100, 'square');
    setTimeout(() => tone(0.12 * vol, 0.05, 900, 700, 'square'), 120);
  },
  pickup() {
    tone(0.15, 0.08, 600, 1200, 'triangle');
  },
  door(vol: number) {
    tone(0.2 * vol, 0.15, 160, 90, 'triangle');
  },
  kill() {
    tone(0.2, 0.12, 700, 1400, 'triangle');
    setTimeout(() => tone(0.2, 0.15, 1000, 1800, 'triangle'), 90);
  },
  click() {
    tone(0.08, 0.03, 1200, 1000, 'square');
  },
  alert() {
    tone(0.2, 0.25, 500, 500, 'sine');
    setTimeout(() => tone(0.2, 0.25, 700, 700, 'sine'), 260);
  },
  throwItem(vol: number) {
    noise(0.12 * vol, 0.15, 1500, 'bandpass');
  },
};
