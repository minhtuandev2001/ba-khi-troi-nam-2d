export interface Settings {
  volume: number;
  sfx: boolean;
  ambient: boolean;
  showFps: boolean;
  damageNumbers: boolean;
  touchControls: 'auto' | 'on' | 'off';
  touchSize: number;
  screenShake: boolean;
  quality: 'high' | 'low';
}

const KEY = 'br2d_settings';

const DEFAULTS: Settings = {
  volume: 0.6,
  sfx: true,
  ambient: true,
  showFps: false,
  damageNumbers: true,
  touchControls: 'auto',
  touchSize: 1,
  screenShake: true,
  quality: 'high',
};

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings: Settings = load();

const listeners = new Set<(s: Settings) => void>();

export function onSettingsChange(fn: (s: Settings) => void): void {
  listeners.add(fn);
}

export function saveSettings(patch: Partial<Settings>) {
  Object.assign(settings, patch);
  localStorage.setItem(KEY, JSON.stringify(settings));
  for (const fn of listeners) fn(settings);
}

export function isTouchDevice(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

export function useTouchControls(): boolean {
  if (settings.touchControls === 'on') return true;
  if (settings.touchControls === 'off') return false;
  return isTouchDevice() && window.matchMedia('(pointer: coarse)').matches;
}
