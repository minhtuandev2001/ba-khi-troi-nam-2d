import './style.css';
import { App } from './app';
import { sfx } from './game/audio';
import { preloadIcons } from './game/icons';
import { applyTheme } from './ui/theme';

applyTheme();

// Phaser rasterises text once, so the font has to be ready before a match starts.
void document.fonts?.load("700 16px 'Baloo 2'").catch(() => undefined);
void preloadIcons();

document.addEventListener('click', (e) => {
  if ((e.target as HTMLElement | null)?.closest?.('.btn, .tab, .mode-card, .slot, [data-nav]')) sfx.click();
});

const app = new App();
void app.init();
