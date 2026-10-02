import './style.css';
import { App } from './app';

// Phaser rasterises text once, so the font has to be ready before a match starts.
void document.fonts?.load("700 16px 'Baloo 2'").catch(() => undefined);

const app = new App();
void app.init();
