import { MAP_SIZE, type AirdropNet, type GameMap, type ZoneNet } from '../shared';

export interface MinimapState {
  x: number;
  y: number;
  a: number;
  zone: ZoneNet | null;
  airdrops: AirdropNet[];
}

/** Pre-renders the static map once, then overlays zone, airdrops and the player. */
export class MapRenderer {
  private readonly base: HTMLCanvasElement;

  constructor(private readonly map: GameMap, resolution = 600) {
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = resolution;
    const ctx = this.base.getContext('2d')!;
    const k = resolution / MAP_SIZE;
    ctx.fillStyle = '#7ccf4f';
    ctx.fillRect(0, 0, resolution, resolution);
    for (const d of map.decor) {
      ctx.fillStyle = `#${d.color.toString(16).padStart(6, '0')}`;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(d.x * k, d.y * k, d.r * k, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#3fa02e';
    for (const t of map.trees) {
      ctx.beginPath();
      ctx.arc(t.x * k, t.y * k, Math.max(1.5, t.r * 2.2 * k), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#c3cfd8';
    for (const r of map.rocks) {
      ctx.beginPath();
      ctx.arc(r.x * k, r.y * k, Math.max(1.5, r.r * k), 0, Math.PI * 2);
      ctx.fill();
    }
    for (const h of map.houses) {
      ctx.fillStyle = `#${h.roof.toString(16).padStart(6, '0')}`;
      ctx.fillRect(h.x * k, h.y * k, h.w * k, h.h * k);
      ctx.strokeStyle = '#10284d';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(h.x * k, h.y * k, h.w * k, h.h * k);
    }
    ctx.fillStyle = '#3e4a56';
    for (const w of map.walls) {
      if (w.houseId >= 0) continue;
      ctx.fillRect(w.x * k, w.y * k, Math.max(1, w.w * k), Math.max(1, w.h * k));
    }
  }

  draw(canvas: HTMLCanvasElement, s: MinimapState, opts: { zoom?: number; grid?: boolean } = {}) {
    const ctx = canvas.getContext('2d')!;
    const size = canvas.width;
    const zoom = opts.zoom ?? 1;
    const k = (size / MAP_SIZE) * zoom;
    let ox = 0;
    let oy = 0;
    if (zoom > 1) {
      ox = Math.min(Math.max(s.x * k - size / 2, 0), MAP_SIZE * k - size);
      oy = Math.min(Math.max(s.y * k - size / 2, 0), MAP_SIZE * k - size);
    }
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this.base, -ox, -oy, MAP_SIZE * k, MAP_SIZE * k);

    if (opts.grid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = `${Math.max(10, size / 50)}px sans-serif`;
      for (let i = 1; i < 8; i++) {
        const p = (i * size) / 8;
        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p, size);
        ctx.moveTo(0, p);
        ctx.lineTo(size, p);
        ctx.stroke();
      }
      for (let i = 0; i < 8; i++) {
        ctx.fillText(String.fromCharCode(65 + i), (i + 0.45) * (size / 8), 14);
        ctx.fillText(String(i + 1), 4, (i + 0.55) * (size / 8));
      }
    }

    if (s.zone) {
      const [x, y, r, tx, ty, tr] = s.zone;
      ctx.save();
      ctx.fillStyle = 'rgba(40, 70, 220, 0.35)';
      ctx.beginPath();
      ctx.rect(0, 0, size, size);
      ctx.arc(x * k - ox, y * k - oy, Math.max(0, r * k), 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      ctx.strokeStyle = '#7fb0ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x * k - ox, y * k - oy, Math.max(0, r * k), 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(tx * k - ox, ty * k - oy, Math.max(0, tr * k), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      const d = Math.hypot(s.x - tx, s.y - ty);
      if (d > tr) {
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.beginPath();
        ctx.moveTo(s.x * k - ox, s.y * k - oy);
        ctx.lineTo(tx * k - ox, ty * k - oy);
        ctx.stroke();
      }
      ctx.restore();
    }

    for (const [, ax, ay, landed] of s.airdrops) {
      const px = ax * k - ox;
      const py = ay * k - oy;
      ctx.fillStyle = landed ? '#ff4040' : '#ffb020';
      ctx.fillRect(px - 5, py - 5, 10, 10);
      ctx.strokeStyle = '#000';
      ctx.strokeRect(px - 5, py - 5, 10, 10);
    }

    const px = s.x * k - ox;
    const py = s.y * k - oy;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(s.a);
    ctx.fillStyle = '#ffd34d';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-5, -5);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
