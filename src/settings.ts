export interface Settings {
  volume: number;
  sfx: boolean;
  ambient: boolean;
  music: boolean;
  showFps: boolean;
  damageNumbers: boolean;
  touchSize: number;
  screenShake: boolean;
  autoPickup: boolean;
}

const KEY = 'br2d_settings';

const DEFAULTS: Settings = {
  volume: 0.6,
  sfx: true,
  ambient: true,
  music: true,
  showFps: false,
  damageNumbers: true,
  touchSize: 0.7,
  screenShake: true,
  autoPickup: false,
};

function load(): Settings {
  const out = { ...DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    // older builds stored every key, so 1 here is the old default rather than a choice
    if (saved.touchSize === 1) delete saved.touchSize;
    // keys of removed options are dropped
    for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
      if (typeof saved[key] === typeof DEFAULTS[key]) Object.assign(out, { [key]: saved[key] });
    }
  } catch {
    // corrupt storage falls back to defaults
  }
  return out;
}

export const settings: Settings = load();

const listeners = new Set<(s: Settings) => void>();

export function onSettingsChange(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function saveSettings(patch: Partial<Settings>) {
  Object.assign(settings, patch);
  // only choices that differ from the defaults are stored, so changing a default reaches everyone
  const changed = Object.fromEntries(Object.entries(settings).filter(([k, v]) => DEFAULTS[k as keyof Settings] !== v));
  localStorage.setItem(KEY, JSON.stringify(changed));
  for (const fn of listeners) fn(settings);
}

export function isTouchDevice(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

/** Phones and tablets get on-screen controls; computers (even with a touchscreen) play with keyboard and mouse. */
export function useTouchControls(): boolean {
  return isTouchDevice() && window.matchMedia('(pointer: coarse)').matches;
}
