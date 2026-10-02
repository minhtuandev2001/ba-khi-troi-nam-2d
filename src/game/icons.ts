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

function bullet(cx: number, top: number, w: number, casing: string, tip: string, tipH: number): string {
  const x = cx - w / 2;
  return `<rect x="${x}" y="${top + tipH - 1}" width="${w}" height="${32 - top - tipH + 1}" rx="1.5" fill="${casing}" ${S}/>` +
    `<path d="M${x} ${top + tipH}Q${cx} ${top - 2} ${x + w} ${top + tipH}Z" fill="${tip}" ${S}/>`;
}

function shell(cx: number): string {
  return `<rect x="${cx - 6}" y="11" width="12" height="21" rx="3" fill="#ff5a4a" ${S}/>` +
    `<rect x="${cx - 6}" y="25" width="12" height="7" rx="1.5" fill="#ffc21a" ${S}/>` +
    shine(cx - 4, 13, 2.5, 10, 0.5);
}

function ammoBox(color: string, bullets: string): string {
  return bullets +
    `<rect x="9" y="30" width="46" height="25" rx="5" fill="${color}" ${S}/>` +
    `<rect x="10.5" y="38" width="43" height="8" fill="${O}" opacity="0.18"/>` +
    shine(13, 33, 38, 2.5, 0.5);
}

const ARMOR_FILL = ['', '#c9d6e0', '#3fa3ff', '#3a3f8f'];
const ARMOR_TRIM = ['', '#8a9aa8', '#1e6fc0', '#ffc21a'];
const BAG_FILL = ['', '#d99a4a', '#4fae3a', '#8a4fd6'];
const BAG_DARK = ['', '#9a6224', '#2f7a22', '#5a2fa0'];

function armor(level: number): string {
  return `<g ${S}>` +
    `<path d="M21 8h7c1 4 2.5 6 4 6s3-2 4-6h7l9 9-3 6v29c-6 4-28 4-34 0V23l-3-6z" fill="${ARMOR_FILL[level]}"/>` +
    `<rect x="20" y="36" width="10" height="9" rx="2" fill="${ARMOR_TRIM[level]}"/>` +
    `<rect x="34" y="36" width="10" height="9" rx="2" fill="${ARMOR_TRIM[level]}"/>` +
    `</g>` +
    `<path d="M17 24c1.5 8 1.5 18 1 26" stroke="#fff" stroke-width="3" opacity="0.4" fill="none" stroke-linecap="round"/>` +
    badge(String(level));
}

function bag(level: number): string {
  return `<g ${S}>` +
    `<path d="M24 17v-4a8 8 0 0 1 16 0v4" fill="none"/>` +
    `<rect x="12" y="16" width="40" height="40" rx="11" fill="${BAG_FILL[level]}"/>` +
    `<path d="M13 29c8 5 30 5 38 0" fill="none"/>` +
    `<rect x="20" y="37" width="24" height="13" rx="4" fill="${BAG_DARK[level]}"/>` +
    `</g>` +
    shine(16, 20, 4, 22, 0.4) +
    badge(String(level));
}

function scope(n: number): string {
  const lens = n >= 6 ? '#ffd23f' : '#7fd3ff';
  return `<g ${S}>` +
    `<rect x="22" y="35" width="5" height="9" fill="#2b3542"/>` +
    `<rect x="37" y="35" width="5" height="9" fill="#2b3542"/>` +
    `<rect x="14" y="42" width="34" height="5" rx="2" fill="#55657a"/>` +
    `<rect x="27" y="13" width="10" height="8" rx="2" fill="#55657a"/>` +
    `<rect x="5" y="20" width="53" height="17" rx="8.5" fill="#3a4654"/>` +
    `<ellipse cx="52" cy="28.5" rx="5" ry="8" fill="${lens}"/>` +
    `<rect x="5" y="22.5" width="8" height="12" rx="3" fill="#2b3542"/>` +
    `</g>` +
    shine(16, 23, 28, 3, 0.35) +
    `<ellipse cx="50.6" cy="25.6" rx="1.6" ry="2.6" fill="#fff"/>` +
    badge(`x${n}`);
}

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

  pistol: () =>
    `<g ${S}>` +
    `<path d="M17 30h15l-3.5 20.5a3 3 0 0 1-3 2.5H19a2.5 2.5 0 0 1-2.4-3.1L19 36z" fill="#3d4a5a"/>` +
    `<path d="M31 31v5a5 5 0 0 0 5 5h4v-10" fill="none"/>` +
    `<rect x="12" y="15.5" width="5" height="4" rx="1" fill="#3d4a5a"/>` +
    `<rect x="46" y="15.5" width="4" height="4" rx="1" fill="#3d4a5a"/>` +
    `<rect x="53" y="21.5" width="5" height="7" rx="1" fill="#3d4a5a"/>` +
    `<rect x="9" y="18.5" width="45" height="12" rx="3" fill="#8193a8"/>` +
    `</g>` +
    shine(12, 21, 38, 3, 0.5) +
    `<path d="M20.5 40h6M19.5 45h6" stroke="#6b7c8e" stroke-width="2" stroke-linecap="round"/>`,

  rifle: () =>
    `<g ${S}>` +
    `<path d="M3 25l14-3v14L5 42a2 2 0 0 1-2.6-1.6z" fill="#c97a3a"/>` +
    `<path d="M21 35h7l-2.5 11h-7z" fill="#3a4654"/>` +
    `<path d="M31 35h8l2.5 12.5a2 2 0 0 1-2 2.5H34z" fill="#3a4654"/>` +
    `<rect x="21" y="15.5" width="16" height="6.5" rx="2.5" fill="#2b3542"/>` +
    `<rect x="16" y="22" width="27" height="13" rx="2.5" fill="#55657a"/>` +
    `<rect x="41" y="24.5" width="14" height="9" rx="2" fill="#8193a8"/>` +
    `<rect x="54" y="27" width="8" height="4" rx="1.2" fill="#3a4654"/>` +
    `</g>` +
    shine(19, 24.5, 21, 3, 0.35) +
    shine(44, 27, 8, 2, 0.45) +
    `<rect x="33.5" y="17" width="2.5" height="3.5" fill="#7fd3ff"/>`,

  shotgun: () =>
    `<g ${S}>` +
    `<path d="M3 27l15-3v12L4 41.5a2 2 0 0 1-2.4-1.8z" fill="#b5651d"/>` +
    `<path d="M22 35h7l-2.5 10h-7z" fill="#3a4654"/>` +
    `<rect x="34" y="24" width="27" height="5.5" rx="1.8" fill="#3a4654"/>` +
    `<rect x="34" y="29.5" width="22" height="4.5" rx="1.8" fill="#3a4654"/>` +
    `<rect x="17" y="23" width="18" height="12" rx="2.5" fill="#55657a"/>` +
    `<rect x="38" y="28" width="13" height="8" rx="2.5" fill="#d9893a"/>` +
    `</g>` +
    shine(20, 25.5, 12, 3, 0.35) +
    `<path d="M41.5 30.5v3.5M44.5 30.5v3.5M47.5 30.5v3.5" stroke="#8a4a14" stroke-width="1.6" stroke-linecap="round"/>` +
    `<rect x="23" y="29" width="7" height="3" rx="1" fill="#ff5a4a"/>`,

  sniper: () =>
    `<g ${S}>` +
    `<path d="M2 28l13-2v11l-7 4H3.5A1.5 1.5 0 0 1 2 39.5z" fill="#7a8f3a"/>` +
    `<path d="M44 33l-4 12M46 33l4 12" fill="none"/>` +
    `<path d="M19 35h6l-2 9h-6z" fill="#2b3542"/>` +
    `<rect x="21" y="22" width="3" height="5" fill="#2b3542"/>` +
    `<rect x="31" y="22" width="3" height="5" fill="#2b3542"/>` +
    `<rect x="37" y="28.5" width="25" height="4.5" rx="1.5" fill="#2b3542"/>` +
    `<rect x="14" y="26" width="24" height="10" rx="2.5" fill="#5a6e2c"/>` +
    `<rect x="16" y="14" width="23" height="8.5" rx="4.25" fill="#2b3542"/>` +
    `<circle cx="39" cy="18.25" r="4.75" fill="#7fd3ff"/>` +
    `</g>` +
    shine(17, 28, 18, 2.5, 0.35) +
    shine(20, 15.8, 14, 2, 0.35) +
    `<circle cx="37.6" cy="16.9" r="1.4" fill="#fff"/>`,

  ammo_9mm: () => ammoBox('#ffc21a', bullet(20, 17, 8, '#e0a63a', '#c47a3a', 7) + bullet(32, 17, 8, '#e0a63a', '#c47a3a', 7) + bullet(44, 17, 8, '#e0a63a', '#c47a3a', 7)),
  ammo_556: () => ammoBox('#4fae3a', bullet(20, 9, 7, '#e8b84a', '#c47a3a', 10) + bullet(32, 9, 7, '#e8b84a', '#c47a3a', 10) + bullet(44, 9, 7, '#e8b84a', '#c47a3a', 10)),
  ammo_12g: () => ammoBox('#e8553e', shell(24) + shell(40)),
  ammo_762: () => ammoBox('#2f8fe0', bullet(25, 5, 9, '#e8b84a', '#9a5a2a', 12) + bullet(39, 5, 9, '#e8b84a', '#9a5a2a', 12)),

  medkit: () =>
    `<g ${S}>` +
    `<path d="M24 18v-5a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v5" fill="none"/>` +
    `<rect x="8" y="18" width="48" height="36" rx="8" fill="#ffffff"/>` +
    `<path d="M27 24h10v9h9v10h-9v9H27v-9h-9V33h9z" fill="#ff4d4d"/>` +
    `</g>` +
    `<rect x="11" y="45" width="42" height="6" rx="3" fill="${O}" opacity="0.1"/>` +
    shine(29, 26, 3, 9, 0.5),

  grenade: () =>
    `<g ${S}>` +
    `<circle cx="30" cy="40" r="17" fill="#6b8e23"/>` +
    `<rect x="24" y="16" width="12" height="9" rx="2" fill="#8a96a3"/>` +
    `<path d="M36 19h6a4 4 0 0 1 4 4v15" fill="none" stroke-width="7"/>` +
    `<circle cx="47" cy="12" r="5" fill="none" stroke-width="6"/>` +
    `</g>` +
    `<path d="M36 19h6a4 4 0 0 1 4 4v15" fill="none" stroke="#b9c4cc" stroke-width="3" stroke-linecap="round"/>` +
    `<circle cx="47" cy="12" r="5" fill="none" stroke="#ffd23f" stroke-width="2.5"/>` +
    `<path d="M14.5 40h31M30 24.5v31" stroke="#4a6418" stroke-width="2"/>` +
    `<ellipse cx="23.5" cy="33" rx="5" ry="3.5" fill="#fff" opacity="0.4"/>`,

  smoke: () =>
    `<g ${S}>` +
    `<rect x="22" y="15" width="16" height="8" rx="2" fill="#5a6a7a"/>` +
    `<rect x="18" y="22" width="24" height="34" rx="5" fill="#a9b5c0"/>` +
    `<rect x="18" y="34" width="24" height="8" fill="#ff9a1f"/>` +
    `<circle cx="44" cy="14" r="7" fill="#eef2f6"/>` +
    `<circle cx="53" cy="21" r="5" fill="#eef2f6"/>` +
    `<circle cx="37" cy="7.5" r="4.5" fill="#eef2f6"/>` +
    `</g>` +
    shine(21, 25, 4, 26, 0.4),

  armor1: () => armor(1),
  armor2: () => armor(2),
  armor3: () => armor(3),
  bag1: () => bag(1),
  bag2: () => bag(2),
  bag3: () => bag(3),
  scope2: () => scope(2),
  scope3: () => scope(3),
  scope4: () => scope(4),
  scope6: () => scope(6),
  scope8: () => scope(8),
};

export function iconSvg(id: IconId, size = 64): string {
  const body = BODIES[id]?.() ?? '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">${body}</svg>`;
}

/** Level-neutral crosshair for scope controls, which show the current level next to it. */
export function scopeGlyph(size = 20): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">` +
    `<circle cx="12" cy="12" r="7.5"/><path d="M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>`;
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
