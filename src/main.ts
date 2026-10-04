import './style.css';
import './ui/components.css';
import { App } from './app';
import { sfx, unlockOnFirstGesture } from './game/audio';
import { preloadIcons } from './game/icons';
import { printConsoleNotice } from './license';
import { initTabletLandscape } from './ui/orientation';
import { applyTheme } from './ui/theme';

printConsoleNotice();
applyTheme();
unlockOnFirstGesture();
initTabletLandscape();

// Phaser rasterises text once, so the font has to be ready before a match starts.
void document.fonts?.load("700 16px 'Baloo 2'").catch(() => undefined);
void preloadIcons();

// every clickable control in menus, HUD and overlays; the touch action buttons play their own game sounds
const CLICKABLE = 'button, a[href], [role="button"], .btn, .tab, .mode-card, .slot, .map-tile, .scope-chip, .inv-cell, .switch-row, .interactive, [data-nav], [data-v], [data-act], input[type="checkbox"], select';
document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement | null)?.closest?.(CLICKABLE);
  if (!el || el.closest('.tbtn') || el.matches(':disabled, [aria-disabled="true"]')) return;
  sfx.click();
});

const app = new App();
void app.init();
