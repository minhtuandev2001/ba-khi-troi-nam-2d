import Phaser from 'phaser';

/**
 * World art in the spirit of Văn Lang / Âu Lạc: thatched stilt houses, bamboo and areca groves,
 * clay jars, wooden palisades and Đông Sơn bronze. Everything is drawn once into textures so the
 * scene renders cheap quads instead of replaying vector paths every frame.
 */

type G = Phaser.GameObjects.Graphics;
type P = Phaser.Math.Vector2;
const vec = (x: number, y: number) => new Phaser.Math.Vector2(x, y);

export const TEX = {
  grass: 'w_grass',
  bamboo: 'w_bamboo',
  banana: 'w_banana',
  areca: 'w_areca',
  trunkBamboo: 'w_trunk_bamboo',
  trunkBanana: 'w_trunk_banana',
  trunkAreca: 'w_trunk_areca',
  jar: 'w_jar',
  boulder: 'w_boulder',
  boulder2: 'w_boulder2',
  stakes: 'w_stakes',
  thatch: 'w_thatch',
  slats: 'w_slats',
  chest: 'w_chest',
  drum: 'w_drum',
  lacBird: 'w_lacbird',
  plume: 'w_plume',
} as const;

/** Radius the round props are drawn at inside their 128px texture (the rest is shadow). */
export const PROP_RADIUS = 54;
/** Trunk radius inside the 64px trunk textures. */
export const TRUNK_RADIUS = 28;
/** Chest body size inside its 64px texture. */
export const CHEST_BODY = 52;

const INK = 0x2a1a0e;

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Lens-shaped leaf or feather from (cx, cy) towards `ang`. */
function leaf(g: G, cx: number, cy: number, ang: number, len: number, width: number, color: number, alpha = 1, fat = 1) {
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const n = 10;
  const pts: P[] = [];
  const half = (t: number) => Math.pow(Math.sin(Math.PI * t), fat) * width / 2;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(vec(cx + ca * t * len - sa * half(t), cy + sa * t * len + ca * half(t)));
  }
  for (let i = n - 1; i > 0; i--) {
    const t = i / n;
    pts.push(vec(cx + ca * t * len + sa * half(t), cy + sa * t * len - ca * half(t)));
  }
  g.fillStyle(color, alpha);
  g.fillPoints(pts, true);
}

function star(g: G, cx: number, cy: number, points: number, outer: number, inner: number, color: number) {
  const pts: P[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    pts.push(vec(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  g.fillStyle(color, 1);
  g.fillPoints(pts, true);
}

function blob(g: G, cx: number, cy: number, radius: number, wobble: number, seed: number, color: number, alpha = 1): P[] {
  const r = rng(seed);
  const pts: P[] = [];
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const d = radius - r() * wobble;
    pts.push(vec(cx + Math.cos(a) * d, cy + Math.sin(a) * d));
  }
  g.fillStyle(color, alpha);
  g.fillPoints(pts, true);
  return pts;
}

export function makeWorldTextures(scene: Phaser.Scene) {
  const make = (key: string, w: number, h: number, draw: (g: G) => void) => {
    if (scene.textures.exists(key)) return;
    const g = scene.add.graphics();
    draw(g);
    g.generateTexture(key, w, h);
    g.destroy();
  };

  // meadow grass; blobs are drawn wrapped so the tile has no seams
  make(TEX.grass, 128, 128, (g) => {
    const r = rng(7);
    g.fillStyle(0x9aab58, 1);
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 22; i++) {
      const x = r() * 128;
      const y = r() * 128;
      const rad = 8 + r() * 14;
      g.fillStyle(r() < 0.5 ? 0x8c9f4c : 0xa9b866, 0.55);
      for (const dx of [-128, 0, 128]) for (const dy of [-128, 0, 128]) g.fillCircle(x + dx, y + dy, rad);
    }
    for (let i = 0; i < 70; i++) {
      const x = 4 + r() * 120;
      const y = 8 + r() * 116;
      g.lineStyle(1.5, i % 3 ? 0x6f8536 : 0xc6cf84, 0.9);
      g.lineBetween(x, y, x - 2.5, y - 5);
      g.lineBetween(x, y, x, y - 7);
      g.lineBetween(x, y, x + 2.5, y - 5);
    }
    for (let i = 0; i < 5; i++) {
      g.fillStyle(i % 2 ? 0xf6e7a8 : 0xe8b0a0, 0.95);
      g.fillCircle(6 + r() * 116, 6 + r() * 116, 1.8);
    }
  });

  // lũy tre: culm tops in the middle, arching sprays of slender leaves around them
  make(TEX.bamboo, 192, 192, (g) => {
    const r = rng(11);
    const c = 96;
    const sprays = 11;
    const sprayLeaves = (dark: boolean) => {
      for (let i = 0; i < sprays; i++) {
        const a = (i / sprays) * Math.PI * 2 + (i % 2) * 0.18;
        const reach = 58 + (i % 3) * 10;
        for (let k = 0; k < 6; k++) {
          const t = 0.3 + k * 0.13;
          const bend = a + t * 0.35;
          const x = c + Math.cos(bend) * reach * t;
          const y = c + Math.sin(bend) * reach * t;
          for (let f = -1; f <= 1; f++) {
            const dir = bend + f * 0.55 + (r() - 0.5) * 0.3;
            const len = 20 + r() * 8 - k;
            if (dark) leaf(g, x + 2, y + 3, dir, len + 2, 7, 0x2c4a1c, 0.9);
            else leaf(g, x, y, dir, len, 5.5, [0x5d8a2e, 0x7aa23c, 0x9cbc58][(i + k + f + 3) % 3]);
          }
        }
      }
    };
    sprayLeaves(true);
    g.lineStyle(2.5, 0x7d8a3a, 1);
    for (let i = 0; i < sprays; i++) {
      const a = (i / sprays) * Math.PI * 2 + (i % 2) * 0.18;
      const reach = 58 + (i % 3) * 10;
      g.beginPath();
      g.moveTo(c, c);
      for (let t = 0.1; t <= 1.01; t += 0.15) {
        const bend = a + t * 0.35;
        g.lineTo(c + Math.cos(bend) * reach * t, c + Math.sin(bend) * reach * t);
      }
      g.strokePath();
    }
    sprayLeaves(false);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.3;
      const d = i % 2 ? 16 : 9;
      const x = c + Math.cos(a) * d;
      const y = c + Math.sin(a) * d;
      g.fillStyle(0xd8cf7a, 1);
      g.fillCircle(x, y, 6);
      g.lineStyle(2, 0x5f6a26, 1);
      g.strokeCircle(x, y, 6);
      g.fillStyle(0x8a8a3a, 1);
      g.fillCircle(x, y, 2.5);
    }
  });

  // chuối: a few huge torn leaves
  make(TEX.banana, 192, 192, (g) => {
    const c = 96;
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (i % 2) * 0.2;
      leaf(g, c, c, a, 92, 52, 0x24561d, 1, 0.7);
    }
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (i % 2) * 0.2;
      leaf(g, c, c, a, 88, 46, 0x58aa3c, 1, 0.7);
      const px = -Math.sin(a) * 7;
      const py = Math.cos(a) * 7;
      leaf(g, c + px, c + py, a, 84, 22, 0x76c24e, 1, 0.8);
      g.lineStyle(2.5, 0xd8ecaa, 1);
      g.lineBetween(c, c, c + Math.cos(a) * 82, c + Math.sin(a) * 82);
      g.lineStyle(2, 0x24561d, 1);
      for (const t of [0.42, 0.6, 0.76]) {
        const mx = c + Math.cos(a) * 88 * t;
        const my = c + Math.sin(a) * 88 * t;
        const w = Math.pow(Math.sin(Math.PI * t), 0.7) * 23;
        g.lineBetween(mx - Math.sin(a) * w * 0.35, my + Math.cos(a) * w * 0.35, mx - Math.sin(a) * w, my + Math.cos(a) * w);
      }
    }
    g.fillStyle(0x8aa848, 1);
    g.fillCircle(c, c, 10);
    g.lineStyle(2, 0x3f5a22, 1);
    g.strokeCircle(c, c, 10);
  });

  // cau: a star of feathery fronds around a cluster of nuts
  make(TEX.areca, 192, 192, (g) => {
    const c = 96;
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      for (let t = 0.15; t < 0.97; t += 0.065) {
        const x = c + ca * 86 * t;
        const y = c + sa * 86 * t;
        const l = 15 * (1 - t * 0.45);
        for (const side of [-1, 1]) {
          const la = a + side * 2.3;
          g.lineStyle(3.2, 0x1f4a1a, 1);
          g.lineBetween(x, y, x + Math.cos(la) * l, y + Math.sin(la) * l);
          g.lineStyle(2, side > 0 ? 0x5aa83f : 0x4a9434, 1);
          g.lineBetween(x, y, x + Math.cos(la) * (l - 1), y + Math.sin(la) * (l - 1));
        }
      }
      g.lineStyle(3, 0x3d7a2a, 1);
      g.lineBetween(c, c, c + ca * 88, c + sa * 88);
    }
    g.fillStyle(0x7a8a3a, 1);
    g.fillCircle(c, c, 10);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.fillStyle(0xd9922c, 1);
      g.fillCircle(c + Math.cos(a) * 8, c + Math.sin(a) * 8, 4);
    }
  });

  make(TEX.trunkBamboo, 64, 64, (g) => {
    const spots: [number, number][] = [[0, 0], [-14, -9], [13, -11], [-16, 9], [12, 12], [0, -20], [-1, 19], [21, 0], [-22, -1]];
    for (const [x, y] of spots) {
      g.fillStyle(0xa8c452, 1);
      g.fillCircle(32 + x, 32 + y, 7);
      g.lineStyle(2, 0x3e5a1c, 1);
      g.strokeCircle(32 + x, 32 + y, 7);
      g.fillStyle(0x5f7a26, 1);
      g.fillCircle(32 + x, 32 + y, 3);
    }
  });
  make(TEX.trunkBanana, 64, 64, (g) => {
    g.fillStyle(0x7f9e4a, 1);
    g.fillCircle(32, 32, TRUNK_RADIUS - 2);
    g.lineStyle(3, 0x3f5a22, 1);
    g.strokeCircle(32, 32, TRUNK_RADIUS - 2);
    g.lineStyle(1.5, 0x5f7e34, 1);
    g.strokeCircle(32, 32, 18);
    g.strokeCircle(32, 32, 10);
  });
  make(TEX.trunkAreca, 64, 64, (g) => {
    g.fillStyle(0x9a8d70, 1);
    g.fillCircle(32, 32, TRUNK_RADIUS - 2);
    g.lineStyle(3, 0x4e4636, 1);
    g.strokeCircle(32, 32, TRUNK_RADIUS - 2);
    g.lineStyle(1.5, 0x7a6e56, 1);
    g.strokeCircle(32, 32, 19);
    g.strokeCircle(32, 32, 11);
  });

  // chum sành: a glazed clay storage jar seen from above
  make(TEX.jar, 128, 128, (g) => {
    const c = 64;
    const R = PROP_RADIUS;
    g.fillStyle(INK, 0.22);
    g.fillCircle(c + 5, c + 7, R);
    g.fillStyle(0x7e4524, 1);
    g.fillCircle(c, c, R);
    g.fillStyle(0x9b5a30, 1);
    g.fillCircle(c - 3, c - 3, R - 8);
    g.fillStyle(0xd09060, 0.55);
    g.fillEllipse(c - 20, c - 22, 34, 16);
    g.lineStyle(2, 0x5e3218, 0.9);
    g.strokeCircle(c, c, R - 13);
    g.fillStyle(0x6a3a1c, 1);
    g.fillCircle(c, c, 30);
    g.fillStyle(0x24130a, 1);
    g.fillCircle(c, c, 23);
    g.lineStyle(4, INK, 1);
    g.strokeCircle(c, c, R);
    g.lineStyle(3, 0x4a2612, 1);
    g.strokeCircle(c, c, 30);
  });

  // núi đá vôi in miniature: mossy limestone boulders, two shapes so they don't repeat
  for (const [key, seed, flip] of [[TEX.boulder, 5, 1], [TEX.boulder2, 17, -1]] as const) {
    make(key, 128, 128, (g) => {
      const c = 64;
      blob(g, c + 5, c + 7, PROP_RADIUS, 6, seed - 2, INK, 0.22);
      const outline = blob(g, c, c, PROP_RADIUS, 8, seed, 0x8f978f);
      blob(g, c - 6, c - 7, PROP_RADIUS - 14, 7, seed + 4, 0xb8beb4);
      blob(g, c - 14, c - 16, 16, 4, seed + 8, 0xd8dcd2);
      g.fillStyle(0x6c9a44, 0.9);
      g.fillCircle(c + 22 * flip, c + 16, 10);
      g.fillCircle(c + 12 * flip, c + 26, 7);
      g.fillCircle(c - 26 * flip, c + 18, 6);
      g.lineStyle(2, 0x5e665e, 0.9);
      g.lineBetween(c - 4 * flip, c + 6, c + 14 * flip, c - 8);
      g.lineBetween(c + 14 * flip, c - 8, c + 26 * flip, c - 6);
      g.lineStyle(4, 0x3e463f, 1);
      g.strokePoints(outline, true);
    });
  }

  // hàng cọc: sharpened log ends along a packed-earth rampart, tiles horizontally
  make(TEX.stakes, 32, 32, (g) => {
    g.fillStyle(0x7a4e2a, 1);
    g.fillRect(0, 0, 32, 32);
    g.fillStyle(0xb07a45, 1);
    g.fillCircle(16, 16, 13);
    g.lineStyle(2.5, 0x4a2c14, 1);
    g.strokeCircle(16, 16, 13);
    g.lineStyle(1.5, 0x8a5a30, 1);
    g.strokeCircle(16, 16, 7.5);
    g.fillStyle(0x6b4423, 1);
    g.fillCircle(16, 16, 2.5);
    g.lineStyle(2, 0x3a2210, 1);
    g.lineBetween(0, 1, 32, 1);
    g.lineBetween(0, 31, 32, 31);
  });

  // thatch: straw strands running down the slope in tiers; light so a tint can colour it
  make(TEX.thatch, 64, 64, (g) => {
    const r = rng(23);
    g.fillStyle(0xf3e3bb, 1);
    g.fillRect(0, 0, 64, 64);
    const colors = [0xd9c290, 0xfff4d8, 0xc7ad78];
    for (let i = 0; i < 150; i++) {
      const x = r() * 64;
      const y = r() * 64;
      const len = 10 + r() * 12;
      g.lineStyle(1.5, colors[i % 3], 1);
      g.lineBetween(x, y, x, Math.min(64, y + len));
      if (y + len > 64) g.lineBetween(x, 0, x, y + len - 64);
    }
    for (let y = 0; y < 64; y += 16) {
      g.lineStyle(2, 0xa88a55, 0.7);
      g.lineBetween(0, y + 0.5, 64, y + 0.5);
      g.lineStyle(2, 0xcdb683, 0.5);
      g.lineBetween(0, y + 3, 64, y + 3);
    }
  });

  // sàn tre: bamboo slats with nodes; light so a tint can colour it
  make(TEX.slats, 64, 64, (g) => {
    const r = rng(31);
    g.fillStyle(0xf6ead0, 1);
    g.fillRect(0, 0, 64, 64);
    for (let y = 0; y < 64; y += 8) {
      g.lineStyle(1.5, 0xa88458, 0.9);
      g.lineBetween(0, y + 0.75, 64, y + 0.75);
      g.lineStyle(1, 0xffffff, 0.35);
      g.lineBetween(0, y + 2.5, 64, y + 2.5);
      g.lineStyle(1.2, 0xb9956a, 1);
      for (let k = 0; k < 2; k++) {
        const x = 4 + r() * 56;
        g.lineBetween(x, y + 2, x, y + 7);
      }
    }
  });

  // hòm gỗ sơn then: lacquered casket with bronze fittings and a Đông Sơn sun medallion
  make(TEX.chest, 64, 64, (g) => {
    const s = CHEST_BODY;
    const o = (64 - s) / 2;
    g.fillStyle(INK, 0.25);
    g.fillRoundedRect(o + 3, o + 5, s, s, 6);
    g.fillStyle(0x5a2414, 1);
    g.fillRoundedRect(o, o, s, s, 6);
    g.fillStyle(0x7a3420, 1);
    g.fillRoundedRect(o + 6, o + 6, s - 12, s - 12, 4);
    g.lineStyle(3, INK, 1);
    g.strokeRoundedRect(o, o, s, s, 6);
    g.fillStyle(0xc8963e, 1);
    for (const [x, y] of [[o, o], [o + s - 11, o], [o, o + s - 11], [o + s - 11, o + s - 11]]) {
      g.fillRect(x + 2, y + 2, 9, 9);
    }
    g.fillStyle(0xd0a04a, 1);
    g.fillCircle(32, 32, 13);
    g.lineStyle(2, 0x7a5420, 1);
    g.strokeCircle(32, 32, 13);
    g.strokeCircle(32, 32, 9.5);
    star(g, 32, 32, 10, 9, 4, 0xf6dc8a);
  });

  // trống đồng: the bronze drum face with its central sun, rings and frogs on the rim
  make(TEX.drum, 128, 128, (g) => {
    const c = 64;
    g.fillStyle(INK, 0.25);
    g.fillCircle(c + 4, c + 6, 60);
    g.fillStyle(0xb48543, 1);
    g.fillCircle(c, c, 60);
    g.fillStyle(0x5f9a7a, 0.3);
    g.fillCircle(c + 26, c - 30, 16);
    g.fillCircle(c - 34, c + 20, 12);
    g.lineStyle(2, 0x6e4e22, 1);
    for (const r of [53, 45, 35, 23]) g.strokeCircle(c, c, r);
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      g.lineBetween(c + Math.cos(a) * 46, c + Math.sin(a) * 46, c + Math.cos(a) * 52, c + Math.sin(a) * 52);
    }
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const x = c + Math.cos(a) * 40;
      const y = c + Math.sin(a) * 40;
      g.strokeCircle(x, y, 3.2);
      g.fillStyle(0x6e4e22, 1);
      g.fillCircle(x, y, 1.2);
    }
    // flying Lạc birds reduced to chevrons circling the sun
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const x = c + Math.cos(a) * 29;
      const y = c + Math.sin(a) * 29;
      const t = a + Math.PI / 2;
      g.lineBetween(x - Math.cos(t) * 5 - Math.cos(a) * 3, y - Math.sin(t) * 5 - Math.sin(a) * 3, x, y);
      g.lineBetween(x, y, x + Math.cos(t) * 5 - Math.cos(a) * 3, y + Math.sin(t) * 5 - Math.sin(a) * 3);
    }
    star(g, c, c, 14, 20, 8, 0xf0cf7a);
    g.fillStyle(0xb48543, 1);
    g.fillCircle(c, c, 5);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      g.fillStyle(0x7e5a26, 1);
      g.fillEllipse(c + Math.cos(a) * 56, c + Math.sin(a) * 56, 9, 9);
    }
    g.lineStyle(4, 0x4e3414, 1);
    g.strokeCircle(c, c, 60);
  });

  // chim Lạc carrying the drum down: long beak forward, wings spread
  make(TEX.lacBird, 256, 128, (g) => {
    const cx = 128;
    const wing = (side: number) => {
      const pts: P[] = [];
      const qx = (t: number, a: number, b: number, k: number) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * k + t * t * b;
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        pts.push(vec(cx + side * (qx(t, 10, 118, 62)), qx(t, 60, 42, 26)));
      }
      for (let i = 1; i <= 12; i++) {
        const t = i / 12;
        const bump = i % 2 ? 7 : 0;
        pts.push(vec(cx + side * qx(t, 118, 12, 70), qx(t, 42, 84, 100) + bump));
      }
      return pts;
    };
    for (const side of [-1, 1]) {
      const pts = wing(side);
      g.fillStyle(0xf2e6cc, 1);
      g.fillPoints(pts, true);
      g.lineStyle(3, 0x3a2412, 1);
      g.strokePoints(pts, true);
      g.lineStyle(1.5, 0xb89a6a, 1);
      for (let k = 1; k < 6; k++) {
        const x = cx + side * (18 + k * 17);
        g.lineBetween(x, 56 - k * 2, x + side * 6, 78 + (k % 2) * 4);
      }
    }
    g.fillStyle(0xe9dcc0, 1);
    g.fillEllipse(cx, 70, 24, 58);
    g.lineStyle(2.5, 0x3a2412, 1);
    g.strokeEllipse(cx, 70, 24, 58);
    g.fillStyle(0xf2e6cc, 1);
    g.fillTriangle(cx - 10, 96, cx + 10, 96, cx, 124);
    g.strokeTriangle(cx - 10, 96, cx + 10, 96, cx, 124);
    g.fillStyle(0xc8963e, 1);
    g.fillTriangle(cx - 3.5, 40, cx + 3.5, 40, cx, 4);
    g.strokeTriangle(cx - 3.5, 40, cx + 3.5, 40, cx, 4);
    g.fillStyle(0xe9dcc0, 1);
    g.fillCircle(cx, 42, 8);
    g.strokeCircle(cx, 42, 8);
    g.fillStyle(0x3a2412, 1);
    g.fillCircle(cx, 40, 2);
  });

  // mũ lông chim: the feathered headdress of Đông Sơn warriors, attached at the right edge
  make(TEX.plume, 64, 64, (g) => {
    const spec: [number, number][] = [[-0.75, 38], [-0.38, 45], [0, 50], [0.38, 45], [0.75, 38]];
    for (const [da, len] of spec) leaf(g, 60, 32, Math.PI + da, len + 2, 12, INK);
    for (const [da, len] of spec) {
      const a = Math.PI + da;
      leaf(g, 60, 32, a, len, 9, 0xf2e8d0);
      const tx = 60 + Math.cos(a) * len * 0.62;
      const ty = 32 + Math.sin(a) * len * 0.62;
      leaf(g, tx, ty, a, len * 0.38, 7, 0x7a3e1c);
      g.lineStyle(1.2, 0xb08a5a, 1);
      g.lineBetween(60, 32, 60 + Math.cos(a) * len * 0.62, 32 + Math.sin(a) * len * 0.62);
    }
  });
}
