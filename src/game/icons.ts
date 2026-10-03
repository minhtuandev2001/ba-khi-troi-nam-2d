import { ITEM_IDS, type ItemId } from '../shared';

export type IconId = ItemId | 'fists';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export const RARITY_COLOR: Record<Rarity, number> = {
  common: 0xb8c6d4,
  uncommon: 0x6fdc3f,
  rare: 0x3fa3ff,
  epic: 0xb07cff,
  legendary: 0xffc21a,
};

export const RARITY_NAME: Record<Rarity, string> = {
  common: 'Thường',
  uncommon: 'Khá',
  rare: 'Hiếm',
  epic: 'Sử thi',
  legendary: 'Huyền thoại',
};

const RARITY: Record<IconId, Rarity> = {
  fists: 'common',
  knife: 'common',
  pistol: 'common',
  shotgun: 'uncommon',
  rifle: 'rare',
  sniper: 'legendary',
  ammo_9mm: 'common',
  ammo_556: 'common',
  ammo_12g: 'common',
  ammo_762: 'uncommon',
  medkit: 'uncommon',
  grenade: 'uncommon',
  smoke: 'common',
  armor1: 'common',
  armor2: 'rare',
  armor3: 'legendary',
  bag1: 'common',
  bag2: 'rare',
  bag3: 'epic',
  scope2: 'common',
  scope3: 'uncommon',
  scope4: 'rare',
  scope6: 'epic',
  scope8: 'legendary',
};

export function rarityOf(id: IconId): Rarity {
  return RARITY[id] ?? 'common';
}

export function rarityCss(id: IconId): string {
  return `#${RARITY_COLOR[rarityOf(id)].toString(16).padStart(6, '0')}`;
}

// ------------------------------------------------------------------ drawing

const O = '#10284d';
const S = `stroke="${O}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;
const shine = (x: number, y: number, w: number, h: number, o = 0.4) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(w, h) / 2}" fill="#fff" opacity="${o}"/>`;

function badge(text: string): string {
  const w = 10 + 8 * text.length;
  const x = 61 - w;
  return `<rect x="${x}" y="43" width="${w}" height="18" rx="9" fill="#ffd23f" ${S}/>` +
    `<text x="${x + w / 2}" y="56.5" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="13" fill="${O}">${text}</text>`;
}

/** Draws `body` in a local frame moved to (x, y) and turned by `deg`. */
const place = (x: number, y: number, deg: number, body: string) => `<g transform="translate(${x} ${y}) rotate(${deg})">${body}</g>`;

/** A stroke with the dark outline underneath, for bows, shafts and strings. */
const line2 = (d: string, w: number, color: string) =>
  `<path d="${d}" fill="none" stroke="${O}" stroke-width="${w + 3}" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

/** Arrow along +x from its fletching at 0 to its tip at `len`; `claw` gives it the hooked Kim Quy talon. */
function arrow(len: number, shaft: string, head: string, fletch: string, w = 2.5, claw = false): string {
  const tip = claw
    ? `<path d="M${len - 9} -5C${len - 2} -6 ${len + 4} -3 ${len + 5} 2C${len + 1} 0 ${len - 3} 1.5 ${len - 9} 5z" fill="${head}" ${S}/>`
    : `<path d="M${len - 8} -5L${len + 3} 0L${len - 8} 5z" fill="${head}" ${S}/>`;
  const vanes = `<path d="M1 -1.5L-1 -6.5H7L13 -1.5zM1 1.5L-1 6.5H7L13 1.5z" fill="${fletch}" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>`;
  return line2(`M0 0H${len - 6}`, w, shaft) + vanes + tip;
}

/** Lens-shaped leaf from (0, 0) along +x. */
const leaf = (len: number, w: number, fill: string) => `<path d="M0 0Q${len / 2} ${-w} ${len} 0Q${len / 2} ${w} 0 0z" fill="${fill}" ${S}/>`;

function sparkle(x: number, y: number, r: number): string {
  const k = r * 0.28;
  return `<path d="M${x} ${y - r}Q${x + k} ${y - k} ${x + r} ${y}Q${x + k} ${y + k} ${x} ${y + r}Q${x - k} ${y + k} ${x - r} ${y}Q${x - k} ${y - k} ${x} ${y - r}z" fill="#fff6c2" stroke="${O}" stroke-width="1.5" stroke-linejoin="round"/>`;
}

function dart(len: number): string {
  return line2(`M4 0H${len}`, 1.8, '#e8cf8a') +
    `<path d="M${len - 1} -2.8L${len + 6} 0L${len - 1} 2.8z" fill="#8a96a3" ${S}/>` +
    `<circle cx="3" cy="0" r="4.5" fill="#fffaf0" ${S}/>`;
}

const ARMOR_FILL = ['', '#dcb878', '#9a6234', '#e3ac30'];
const ARMOR_DARK = ['', '#a07a40', '#5c3417', '#2f8a6a'];
const ARMOR_BODY = 'M21 8h7c1 4 2.5 6 4 6s3-2 4-6h7l9 9-3 6v29c-6 4-28 4-34 0V23l-3-6z';

/** Cấp 1 woven rattan, cấp 2 laced buffalo hide, cấp 3 Đông Sơn bronze plates with the sun disc. */
function armor(level: number): string {
  const dark = ARMOR_DARK[level];
  let pattern = '';
  if (level === 1) {
    for (let i = 0; i < 5; i++) {
      pattern += `<path d="M17 ${24 + i * 6}H47" stroke="${dark}" stroke-width="2" stroke-dasharray="4 3" stroke-dashoffset="${i % 2 ? 3.5 : 0}"/>`;
    }
    pattern += `<path d="M22 10l3 6M42 10l-3 6" stroke="${dark}" stroke-width="2"/>`;
  } else if (level === 2) {
    pattern += `<path d="M32 17V52" stroke="${dark}" stroke-width="2.5"/>`;
    for (let y = 22; y <= 46; y += 8) pattern += `<path d="M28 ${y}l8 5M36 ${y}l-8 5" stroke="#f2d9a8" stroke-width="1.8" stroke-linecap="round"/>`;
    for (const [x, y] of [[20, 26], [44, 26], [20, 44], [44, 44]]) pattern += `<circle cx="${x}" cy="${y}" r="2" fill="#e8c27a" stroke="${O}" stroke-width="1.2"/>`;
  } else {
    pattern += `<path d="M18 44Q32 48 46 44M18 50Q32 54 46 50" stroke="${dark}" stroke-width="2.5" fill="none"/>`;
    pattern += `<circle cx="32" cy="31" r="10" fill="#f7d978" ${S}/>`;
    const pts: string[] = [];
    for (let i = 0; i < 16; i++) {
      const r = i % 2 ? 3 : 8;
      const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
      pts.push(`${(32 + Math.cos(a) * r).toFixed(1)} ${(31 + Math.sin(a) * r).toFixed(1)}`);
    }
    pattern += `<path d="M${pts.join('L')}z" fill="${dark}"/>`;
  }
  return `<path d="${ARMOR_BODY}" fill="${ARMOR_FILL[level]}" ${S}/>` +
    pattern +
    `<path d="${ARMOR_BODY}" fill="none" ${S}/>` +
    `<path d="M17 24c1.5 8 1.5 18 1 26" stroke="#fff" stroke-width="3" opacity="0.4" fill="none" stroke-linecap="round"/>` +
    badge(String(level));
}

const BAG_FILL = ['', '#e3b56e', '#b8793a', '#8a4a22'];
const BAG_DARK = ['', '#a8743e', '#7a4a1e', '#4a200c'];

/** Gùi: a conical carrying basket woven from bamboo strips, seen from the side. */
function bag(level: number): string {
  const dark = BAG_DARK[level];
  const band = level === 3
    ? `<path d="M15.5 33l4 5 4-5 4 5 4-5 4 5 4-5 4 5 4-5" stroke="#e8553e" stroke-width="2.5" fill="none" stroke-linejoin="round"/>`
    : '';
  return `<path d="M17 13C13 4 27 2 28 12M47 13C51 4 37 2 36 12" fill="none" stroke="${O}" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="M12 15h40l-7 39c-.5 3-3 5-6 5H25c-3 0-5.5-2-6-5z" fill="${BAG_FILL[level]}" ${S}/>` +
    `<path d="M20 18l6 39M32 18v40M44 18l-6 39" stroke="${dark}" stroke-width="2"/>` +
    `<path d="M14 27h36M16 39h32M18 50h28" stroke="${dark}" stroke-width="2"/>` +
    band +
    `<rect x="9.5" y="10.5" width="45" height="8" rx="3" fill="${dark}" ${S}/>` +
    shine(15, 21, 3.5, 22, 0.4) +
    badge(String(level));
}

interface BirdLook {
  body: string;
  belly: string;
  wing: string;
  head: string;
  beak: string;
  beakLen: number;
  tail: number;
  hooked?: boolean;
  crest?: string;
  /** Extra marks over the head and wing (eye patch, moustache, wing bar). */
  marks?: string;
}

/** A perched bird facing right, in the colours of its species. */
function bird(b: BirdLook, level: number): string {
  const bl = b.beakLen;
  const beak = b.hooked
    ? `<path d="M49 19Q${50 + bl + 2} 19 ${50 + bl} 27L49 27z" fill="${b.beak}" ${S}/>`
    : `<path d="M49 20L${50 + bl} 23.5L49 27z" fill="${b.beak}" ${S}/>`;
  const crest = b.crest
    ? line2('M38 16Q31 8 24 6', 2.5, b.crest) + line2('M40 15Q36 6 31 2', 2.5, b.crest)
    : '';
  return line2('M5 53Q32 48 59 51', 3.5, '#8a5a2b') +
    `<path d="M24 37L${24 - b.tail} ${47 + b.tail * 0.15}L${29 - b.tail * 0.5} 50z" fill="${b.wing}" ${S}/>` +
    `<path d="M29 46v6M35 46v5" stroke="#e0a63a" stroke-width="2.5" stroke-linecap="round"/>` +
    `<ellipse cx="32" cy="36" rx="14" ry="11" transform="rotate(-25 32 36)" fill="${b.body}" ${S}/>` +
    `<ellipse cx="36" cy="40" rx="8" ry="6" transform="rotate(-25 36 40)" fill="${b.belly}"/>` +
    `<path d="M21 33Q31 24 41 31Q34 44 21 40z" fill="${b.wing}" ${S}/>` +
    crest +
    `<circle cx="43" cy="23" r="9" fill="${b.head}" ${S}/>` +
    beak +
    (b.marks ?? '') +
    `<circle cx="46" cy="21.5" r="2.2" fill="${O}"/><circle cx="46.7" cy="20.8" r="0.8" fill="#fff"/>` +
    badge(`x${level}`);
}

const BIRDS: Record<2 | 3 | 4 | 6 | 8, BirdLook> = {
  2: { body: '#a8743e', belly: '#f2e2c4', wing: '#7a4a22', head: '#8a5a2b', beak: '#e0a63a', beakLen: 6, tail: 11 },
  3: {
    body: '#2e2e38', belly: '#454552', wing: '#1f1f27', head: '#2e2e38', beak: '#ffc21a', beakLen: 7, tail: 13,
    marks: '<circle cx="46.5" cy="22" r="3.6" fill="#ffc21a"/><ellipse cx="30" cy="35" rx="4" ry="2.4" fill="#fff" transform="rotate(-20 30 35)"/>',
  },
  4: {
    body: '#6f8299', belly: '#ece6d8', wing: '#46566a', head: '#46566a', beak: '#ffc21a', beakLen: 6, tail: 15, hooked: true,
    marks: '<path d="M44.5 25l-1 6" stroke="#10284d" stroke-width="2.5" stroke-linecap="round"/>',
  },
  6: { body: '#6b4423', belly: '#8a5a32', wing: '#4a2c14', head: '#f4eddc', beak: '#ffc21a', beakLen: 8, tail: 15, hooked: true },
  8: {
    body: '#f2e6cc', belly: '#fffaf0', wing: '#d4a02a', head: '#f2e6cc', beak: '#c8963e', beakLen: 15, tail: 20, crest: '#c8963e',
    marks: '<path d="M25 34q4-3 8 0M27 38q4-3 8 0" stroke="#8a5a1a" stroke-width="1.5" fill="none"/>',
  },
};

const BODIES: Record<IconId, () => string> = {
  fists: () =>
    `<g ${S}>` +
    `<rect x="13" y="18" width="38" height="30" rx="11" fill="#ffcf9e"/>` +
    `<path d="M22.5 18v9M32 18v9M41.5 18v9" fill="none"/>` +
    `<path d="M13 33c7-3 15-1 17 7" fill="#ffcf9e"/>` +
    `</g>` +
    shine(17, 21, 3, 12, 0.5),

  knife: () =>
    `<g ${S}>` +
    `<path d="M26 37L50 11q6-5 4 2L31 43z" fill="#e4edf5"/>` +
    `<path d="M25 43L12 56a3.5 3.5 0 0 1-5-5l13-13z" fill="#8b4a1a"/>` +
    `<path d="M21.5 35.5l11 11" stroke-width="8"/>` +
    `</g>` +
    `<path d="M21.5 35.5l11 11" stroke="#ffc21a" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="M31 38L50 16" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity="0.85"/>`,

  // ống thổi: a bamboo blowpipe with a red cord mouthpiece, a dart just leaving the tip
  pistol: () =>
    place(30, 34, -35,
      `<rect x="-27" y="-5.5" width="52" height="11" rx="5.5" fill="#dcc47c" ${S}/>` +
      `<path d="M-10 -5.5v11M5 -5.5v11M18 -5.5v11" stroke="#9c8440" stroke-width="2.5"/>` +
      `<rect x="-27" y="-5.5" width="9" height="11" rx="4" fill="#d24a3a" ${S}/>` +
      shine(-15, -3.5, 38, 2.5, 0.55) +
      place(27, 0, 0, dart(10))),

  // cung tên: a bamboo bow drawn back with a bronze-tipped arrow nocked
  rifle: () =>
    place(32, 32, -45,
      line2('M4 -26L-11 0L4 26', 1.4, '#f6ead0') +
      line2('M4 -26Q27 0 4 26', 4.5, '#a8692f') +
      `<rect x="11.5" y="-5" width="7" height="10" rx="2" fill="#d24a3a" ${S}/>` +
      place(-14, 0, 0, arrow(40, '#e0bd84', '#c8963e', '#f2e6cc'))),

  // nỏ liên châu: a wooden stock, horn prod, bronze trigger, and three bolts loaded at once
  shotgun: () =>
    place(32, 34, -28,
      line2('M7 -24L-6 0L7 24', 1.4, '#f6ead0') +
      `<path d="M-15 4l-3 9h5l2-9z" fill="#d4a02a" ${S}/>` +
      `<path d="M-28 -4.5h42l6 4.5-6 4.5h-42a2.5 2.5 0 0 1-2.5-2.5v-4a2.5 2.5 0 0 1 2.5-2.5z" fill="#b8793a" ${S}/>` +
      shine(-24, -2.5, 22, 2, 0.45) +
      line2('M7 -24Q23 0 7 24', 5, '#5c3417') +
      place(-4, -1, -11, arrow(26, '#8a5a2b', '#d4a02a', '#f2e6cc', 2)) +
      place(-4, 1, 11, arrow(26, '#8a5a2b', '#d4a02a', '#f2e6cc', 2)) +
      place(-6, 0, 0, arrow(30, '#8a5a2b', '#d4a02a', '#e8553e', 2))),

  // thần tiễn: a recurved bow sheathed in gold bronze with a red string, loaded with a Kim Quy claw arrow
  sniper: () =>
    place(32, 32, -45,
      line2('M2 -27L-12 0L2 27', 1.6, '#ff5a4a') +
      line2('M2 -27C9 -28 6 -22 10 -17Q29 0 10 17C6 22 9 28 2 27', 5, '#ffc21a') +
      `<path d="M10 -17Q27 0 10 17" fill="none" stroke="#fff3b0" stroke-width="1.6" stroke-linecap="round"/>` +
      `<rect x="13.5" y="-5.5" width="7" height="11" rx="2" fill="#8a2a1a" ${S}/>` +
      `<circle cx="2" cy="-27" r="3" fill="#e8553e" ${S}/><circle cx="2" cy="27" r="3" fill="#e8553e" ${S}/>` +
      place(-15, 0, 0, arrow(44, '#ffd34a', '#ffc21a', '#ff5a4a', 2.5, true))) +
    sparkle(12, 13, 5) + sparkle(53, 53, 4) + sparkle(30, 6, 2.5),

  // kim tre: four bamboo darts with kapok tufts, tied with red cord
  ammo_9mm: () =>
    place(32, 32, -40,
      [-9, -3, 3, 9].map((y) => place(-24, y, 0, dart(40))).join('') +
      `<rect x="-6" y="-14" width="6" height="28" rx="2" fill="#d24a3a" ${S}/>`),

  // mũi tên: a leather quiver of feathered arrows
  ammo_556: () =>
    `<g transform="rotate(15 32 34)">` +
    line2('M25 26V8', 2.2, '#e0bd84') + line2('M32 26V5', 2.2, '#e0bd84') + line2('M39 26V9', 2.2, '#e0bd84') +
    `<path d="M25 8l-4-5v8l4 4 4-4V3z" fill="#e8553e" ${S}/>` +
    `<path d="M32 5l-4-5v8l4 4 4-4V0z" fill="#f2e6cc" ${S}/>` +
    `<path d="M39 9l-4-5v8l4 4 4-4V4z" fill="#ffc21a" ${S}/>` +
    `<rect x="19" y="22" width="26" height="38" rx="7" fill="#8a5a2b" ${S}/>` +
    `<path d="M19.5 30h25M19.5 50h25" stroke="#d4a02a" stroke-width="3"/>` +
    shine(22.5, 33, 3, 14, 0.35) +
    `</g>`,

  // tên nỏ: a bundle of short bronze-headed bolts lashed with rope
  ammo_12g: () =>
    place(32, 33, -20,
      [-12, -6, 0, 6, 12].map((y) => place(-26, y, 0, arrow(46, '#a8692f', '#d4a02a', '#f2e6cc', 2))).join('') +
      `<rect x="-8" y="-17" width="7" height="34" rx="2" fill="#e0bd84" ${S}/>` +
      `<path d="M-8 -8l7 4M-8 2l7 4" stroke="#a07a40" stroke-width="1.5"/>`),

  // tên móng rùa: two gilded arrows tipped with Kim Quy claws over a turtle shell
  ammo_762: () =>
    place(9, 54, -45, arrow(56, '#ffd34a', '#ffc21a', '#ff5a4a', 2.5, true)) +
    place(55, 54, -135, arrow(56, '#ffd34a', '#ffc21a', '#ff5a4a', 2.5, true)) +
    `<ellipse cx="32" cy="47" rx="12" ry="9.5" fill="#6aa84f" ${S}/>` +
    `<path d="M26 47h12M29 41l-3 6 3 6M35 41l3 6-3 6" stroke="#2f5a22" stroke-width="1.8" fill="none" stroke-linejoin="round"/>` +
    sparkle(52, 30, 3.5),

  // thuốc nam: herbs wrapped in a banana leaf and tied with straw, fresh leaves on top
  medkit: () =>
    place(32, 32, -125, leaf(26, 9, '#3f8a2a')) +
    place(32, 32, -90, leaf(28, 9, '#4f9a32')) +
    place(32, 32, -55, leaf(26, 9, '#3f8a2a')) +
    `<rect x="11" y="29" width="42" height="26" rx="8" fill="#9ccc4a" ${S}/>` +
    `<path d="M14 36q18 6 36 0M14 48q18-6 36 0" stroke="#6a9a2a" stroke-width="2" fill="none"/>` +
    `<rect x="28.5" y="28" width="7" height="28" rx="2" fill="#e0bd84" ${S}/>` +
    shine(15, 32, 10, 3, 0.45),

  // hũ lửa: an oil-filled clay jar with a burning wick
  grenade: () =>
    `<path d="M32 18Q29 13 33 9" fill="none" stroke="${O}" stroke-width="2.5" stroke-linecap="round"/>` +
    `<path d="M33 0C40 6 40 12 33 14C26 12 26 6 33 0z" fill="#ff9a1f" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>` +
    `<path d="M33 5C36 8 36 11 33 12C30 11 30 8 33 5z" fill="#ffe066"/>` +
    `<path d="M23 23h18l-2 5c10 4 14 11 14 18 0 9-9 14-21 14S11 55 11 46c0-7 4-14 14-18z" fill="#c4692f" ${S}/>` +
    `<rect x="22" y="16" width="20" height="8" rx="2.5" fill="#e8d3a0" ${S}/>` +
    `<path d="M13 41q19 7 38 0" stroke="#7a3a14" stroke-width="2.5" fill="none"/>` +
    `<path d="M17 47l3 3 3-3 3 3 3-3 3 3 3-3 3 3 3-3 3 3 3-3" stroke="#7a3a14" stroke-width="1.8" fill="none" stroke-linejoin="round"/>` +
    `<ellipse cx="21" cy="35" rx="4.5" ry="3" fill="#fff" opacity="0.4"/>`,

  // bầu khói: a dried gourd stuffed with smouldering mugwort
  smoke: () =>
    `<circle cx="45" cy="14" r="7" fill="#eef2f6" ${S}/>` +
    `<circle cx="54" cy="21" r="5" fill="#eef2f6" ${S}/>` +
    `<circle cx="38" cy="7" r="4.5" fill="#eef2f6" ${S}/>` +
    `<path d="M30 14c5 0 8 4 8 9 0 4-2 6-3 8 7 2 11 8 11 14 0 9-7 15-16 15S14 54 14 45c0-6 4-12 11-14-1-2-3-4-3-8 0-5 3-9 8-9z" fill="#d9c27a" ${S}/>` +
    `<rect x="27" y="9" width="7" height="7" rx="2" fill="#7a4a22" ${S}/>` +
    line2('M22 31q8 3 16 0', 2.5, '#d24a3a') +
    `<path d="M22 42q8 4 16 0M24 50q6 3 12 0" stroke="#a8914a" stroke-width="1.8" fill="none"/>` +
    shine(18, 38, 3, 12, 0.45),

  armor1: () => armor(1),
  armor2: () => armor(2),
  armor3: () => armor(3),
  bag1: () => bag(1),
  bag2: () => bag(2),
  bag3: () => bag(3),
  scope2: () => bird(BIRDS[2], 2),
  scope3: () => bird(BIRDS[3], 3),
  scope4: () => bird(BIRDS[4], 4),
  scope6: () => bird(BIRDS[6], 6),
  scope8: () => bird(BIRDS[8], 8),
};

export function iconSvg(id: IconId, size = 64): string {
  const body = BODIES[id]?.() ?? '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">${body}</svg>`;
}

/** Level-neutral flying bird for the scout-bird controls, which show the current level next to it. */
export function scopeGlyph(size = 20): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor">` +
    `<path d="M1.5 8.5c3.2-.4 6 .8 8.3 3.6L12 14l2.2-1.9c2.3-2.8 5.1-4 8.3-3.6-2.6 1.2-4.4 3.4-5.6 6.1-.9 2-2.7 3.1-4.9 3.1s-4-1.1-4.9-3.1C5.9 11.9 4.1 9.7 1.5 8.5z"/>` +
    `<path d="M12 13.6l-1.3-3.4c.2-1.1.7-1.8 1.3-1.8s1.1.7 1.3 1.8z"/></svg>`;
}

/** The naked eye, for the x1 entry next to the scout birds. */
export function eyeGlyph(size = 20): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round">` +
    `<path d="M1.5 12C4 7.5 7.8 5.5 12 5.5s8 2 10.5 6.5c-2.5 4.5-6.3 6.5-10.5 6.5S4 16.5 1.5 12z"/><circle cx="12" cy="12" r="3.3" fill="currentColor"/></svg>`;
}

/** Inline icon for DOM menus and HUD. */
export function iconHtml(id: IconId, size = 28, extraClass = ''): string {
  return `<span class="item-icon ${extraClass}" style="width:${size}px;height:${size}px">${iconSvg(id, size)}</span>`;
}

// ------------------------------------------------------------------ textures for Phaser

export const ICON_TEXTURE_SIZE = 128;
export const iconTextureKey = (id: IconId) => `icon_${id}`;
export const iconImages = new Map<IconId, HTMLImageElement>();

/** Rasterises every icon once so Phaser can use them as textures. */
export function preloadIcons(): Promise<void> {
  const ids: IconId[] = ['fists', ...ITEM_IDS];
  return Promise.all(
    ids.map(
      (id) =>
        new Promise<void>((resolve) => {
          if (iconImages.has(id)) return resolve();
          const img = new Image(ICON_TEXTURE_SIZE, ICON_TEXTURE_SIZE);
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(id, ICON_TEXTURE_SIZE))}`;
          iconImages.set(id, img);
        }),
    ),
  ).then(() => undefined);
}
