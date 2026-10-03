import { MAP_DEFS, doorOutward, type AirdropNet, type GameMap, type ZoneNet } from '../shared';

export interface MinimapState {
  x: number;
  y: number;
  a: number;
  zone: ZoneNet | null;
  airdrops: AirdropNet[];
  /** Teammates, drawn under the player's own arrow. */
  mates?: { x: number; y: number; color: string; alive: boolean }[];
  /** Map markers; `from` is where their owner stands, null when the owner is not on the map. */
  markers?: { x: number; y: number; color: string; from: { x: number; y: number } | null }[];
}

/** Pre-renders the static map once, then overlays zone, airdrops and the player. */
export class MapRenderer {
  private readonly base: HTMLCanvasElement;

  constructor(private readonly map: GameMap, resolution = map.size / 8) {
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = resolution;
    const ctx = this.base.getContext('2d')!;
    const k = resolution / map.size;
    ctx.fillStyle = MAP_DEFS[map.id].theme.ground;
    ctx.fillRect(0, 0, resolution, resolution);
    for (const d of map.decor) {
      ctx.fillStyle = `#${d.color.toString(16).padStart(6, '0')}`;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(d.x * k, d.y * k, d.r * k, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#4f7a2a';
    for (const t of map.trees) {
      ctx.beginPath();
      ctx.arc(t.x * k, t.y * k, Math.max(1.5, t.r * 2.2 * k), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#d4ccb4';
    for (const r of map.rocks) {
      ctx.beginPath();
      ctx.arc(r.x * k, r.y * k, Math.max(1.5, r.r * k), 0, Math.PI * 2);
      ctx.fill();
    }
    for (const h of map.houses) {
      ctx.fillStyle = `#${h.roof.toString(16).padStart(6, '0')}`;
      ctx.fillRect(h.x * k, h.y * k, h.w * k, h.h * k);
      ctx.strokeStyle = '#2a1a0e';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(h.x * k, h.y * k, h.w * k, h.h * k);
    }
    ctx.fillStyle = '#fff3c4';
    ctx.strokeStyle = '#2a1a0e';
    ctx.lineWidth = 1;
    for (const d of map.doors) {
      const out = doorOutward(map, d);
      if (!out) continue;
      // a tab sticking out of the wall stays legible even where the wall is under a pixel wide
      const len = Math.max(4, Math.max(d.w, d.h) * k);
      const tab = 3;
      const cx = (d.x + d.w / 2) * k + out.dx * tab / 2;
      const cy = (d.y + d.h / 2) * k + out.dy * tab / 2;
      const w = out.dx ? tab : len;
      const h = out.dx ? len : tab;
      ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
      ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
    }
    ctx.fillStyle = '#6b4423';
    for (const w of map.walls) {
      if (w.houseId >= 0) continue;
      ctx.fillRect(w.x * k, w.y * k, Math.max(1, w.w * k), Math.max(1, w.h * k));
    }
  }

  /** Static map only, for the lobby map picker. */
  preview(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.base, 0, 0, canvas.width, canvas.height);
  }

  draw(canvas: HTMLCanvasElement, s: MinimapState, opts: { zoom?: number; grid?: boolean; labels?: boolean } = {}) {
    const ctx = canvas.getContext('2d')!;
    const size = canvas.width;
    const zoom = opts.zoom ?? 1;
    const mapSize = this.map.size;
    const k = (size / mapSize) * zoom;
    let ox = 0;
    let oy = 0;
    if (zoom > 1) {
      ox = Math.min(Math.max(s.x * k - size / 2, 0), mapSize * k - size);
      oy = Math.min(Math.max(s.y * k - size / 2, 0), mapSize * k - size);
    }
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this.base, -ox, -oy, mapSize * k, mapSize * k);

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

    if (opts.labels) {
      ctx.save();
      ctx.font = `600 ${Math.max(10, Math.round(size / 52))}px "Be Vietnam Pro", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(20, 14, 6, 0.85)';
      ctx.fillStyle = '#fff6dc';
      // biggest regions first; a smaller name that would overlap one already drawn is skipped
      const drawn: { x: number; y: number; w: number; h: number }[] = [];
      const lineH = Math.max(10, Math.round(size / 52)) + 4;
      for (const a of [...this.map.areas].sort((p, q) => q.r - p.r)) {
        const lx = (a.lx ?? a.x) * k - ox;
        const ly = (a.ly ?? a.y) * k - oy;
        const w = ctx.measureText(a.name).width + 6;
        const box = { x: lx - w / 2, y: ly - lineH / 2, w, h: lineH };
        if (drawn.some((d) => box.x < d.x + d.w && d.x < box.x + box.w && box.y < d.y + d.h && d.y < box.y + box.h)) continue;
        drawn.push(box);
        ctx.strokeText(a.name, lx, ly);
        ctx.fillText(a.name, lx, ly);
      }
      ctx.restore();
    }

    // a little bronze drum (copper rim, verdigris face, gold sun) sending out drum-beat rings
    const u = Math.max(1, size / 260);
    const beat = (performance.now() % 1600) / 1600;
    const edge = 9 * u;
    const ring = (x: number, y: number, r: number, color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
    };
    for (const [, ax, ay, landed] of s.airdrops) {
      // on the zoomed minimap a drop out of view is pinned to the border, pointing the way to it
      const px = Math.min(Math.max(ax * k - ox, edge), size - edge);
      const py = Math.min(Math.max(ay * k - oy, edge), size - edge);
      for (const shift of [0, 0.5]) {
        const p = (beat + shift) % 1;
        const r = (8 + p * 11) * u;
        ring(px, py, r, `rgba(26, 13, 6, ${0.45 * (1 - p)})`, 4 * u);
        ring(px, py, r, `rgba(255, 210, 87, ${1 - p})`, 2 * u);
      }
      // still falling: a dashed white ring marks where it will land
      if (!landed) {
        ctx.setLineDash([2.5 * u, 2 * u]);
        ring(px, py, 9.5 * u, '#ffffff', 1.5 * u);
        ctx.setLineDash([]);
      }
      ctx.fillStyle = '#b4532a';
      ctx.beginPath();
      ctx.arc(px, py, 7 * u, 0, Math.PI * 2);
      ctx.fill();
      ring(px, py, 7 * u, '#1a0d06', 2 * u);
      ctx.fillStyle = '#2f9a80';
      ctx.beginPath();
      ctx.arc(px, py, 4.6 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffd257';
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const r = (i % 2 ? 1.3 : 3.4) * u;
        ctx.lineTo(px + Math.cos(a) * r, py + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
    }

    const markers = s.markers ?? [];
    ctx.save();
    ctx.lineCap = 'round';
    for (const m of markers) {
      if (!m.from) continue;
      ctx.beginPath();
      ctx.moveTo(m.from.x * k - ox, m.from.y * k - oy);
      ctx.lineTo(m.x * k - ox, m.y * k - oy);
      ctx.setLineDash([5 * u, 4 * u]);
      ctx.strokeStyle = 'rgba(20, 10, 4, 0.6)';
      ctx.lineWidth = 3.4 * u;
      ctx.stroke();
      ctx.strokeStyle = m.color;
      ctx.lineWidth = 1.7 * u;
      ctx.stroke();
    }
    ctx.restore();
    for (const m of markers) {
      // a little banner on a pole; out of view it is pinned to the border like the airdrops
      const px = Math.min(Math.max(m.x * k - ox, 4 * u), size - 12 * u);
      const py = Math.min(Math.max(m.y * k - oy, 16 * u), size - 4 * u);
      const p = beat;
      ring(px, py, (3 + p * 8) * u, `rgba(255, 255, 255, ${0.8 * (1 - p)})`, 1.5 * u);
      ctx.fillStyle = 'rgba(20, 10, 4, 0.5)';
      ctx.beginPath();
      ctx.ellipse(px, py, 3.4 * u, 1.7 * u, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1a0d06';
      ctx.lineWidth = 3 * u;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, py - 14 * u);
      ctx.stroke();
      ctx.strokeStyle = '#f3e3bf';
      ctx.lineWidth = 1.4 * u;
      ctx.stroke();
      ctx.fillStyle = m.color;
      ctx.strokeStyle = '#1a0d06';
      ctx.lineWidth = 1.3 * u;
      ctx.beginPath();
      ctx.moveTo(px + 0.5 * u, py - 14 * u);
      ctx.lineTo(px + 10.5 * u, py - 10.8 * u);
      ctx.lineTo(px + 0.5 * u, py - 7.4 * u);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    for (const m of s.mates ?? []) {
      const mx = m.x * k - ox;
      const my = m.y * k - oy;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      if (m.alive) {
        ctx.fillStyle = m.color;
        ctx.beginPath();
        ctx.arc(mx, my, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.strokeStyle = m.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(mx - 3.5, my - 3.5);
        ctx.lineTo(mx + 3.5, my + 3.5);
        ctx.moveTo(mx + 3.5, my - 3.5);
        ctx.lineTo(mx - 3.5, my + 3.5);
        ctx.stroke();
      }
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
