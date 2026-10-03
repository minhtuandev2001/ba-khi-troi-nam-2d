/** Văn Lang look for the menus: a painted landscape backdrop, a Đông Sơn motif band and mode icons. */

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** A row of rounded limestone towers standing on `base`. */
function karst(seed: number, base: number, minH: number, maxH: number, color: string, opacity = 1) {
  const r = rng(seed);
  let d = '';
  for (let x = -60; x < 1680; ) {
    const w = 70 + r() * 110;
    const h = minH + r() * (maxH - minH);
    const cx = x + w / 2;
    const top = base - h;
    d += `M${x} ${base}C${x} ${base - h * 0.85} ${cx - w * 0.38} ${top} ${cx} ${top}C${cx + w * 0.38} ${top} ${x + w} ${base - h * 0.85} ${x + w} ${base}Z`;
    x += w * (0.45 + r() * 0.4);
  }
  return `<path d="${d}" fill="${color}" opacity="${opacity}"/><rect x="0" y="${base - 2}" width="1600" height="${900 - base}" fill="${color}" opacity="${opacity}"/>`;
}

function drumSun(cx: number, cy: number) {
  const pts: string[] = [];
  for (let i = 0; i < 28; i++) {
    const rad = i % 2 ? 13 : 34;
    const a = (i / 28) * Math.PI * 2 - Math.PI / 2;
    pts.push(`${(cx + Math.cos(a) * rad).toFixed(1)},${(cy + Math.sin(a) * rad).toFixed(1)}`);
  }
  const rings = [100, 84, 62, 44]
    .map((rad) => `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="none" stroke="#d48f32" stroke-width="3" opacity="0.65"/>`)
    .join('');
  let ticks = '';
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const x1 = cx + Math.cos(a) * 66;
    const y1 = cy + Math.sin(a) * 66;
    const x2 = cx + Math.cos(a) * 80;
    const y2 = cy + Math.sin(a) * 80;
    ticks += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#d48f32" stroke-width="2.5" opacity="0.55"/>`;
  }
  return `<circle cx="${cx}" cy="${cy}" r="230" fill="url(#glow)"/>
    <circle cx="${cx}" cy="${cy}" r="112" fill="#f8cd68"/>${rings}${ticks}
    <polygon points="${pts.join(' ')}" fill="#e09a34" opacity="0.85"/>`;
}

function bird(x: number, y: number, s: number) {
  return `<path transform="translate(${x} ${y}) scale(${s})" d="M-22 0Q-11 -10 0 0Q11 -10 22 0" fill="none" stroke="#7a4524" stroke-width="3.2" stroke-linecap="round"/>`;
}

/** Nhà sàn with a boat-shaped roof whose gable ends sweep up into horns. */
function stiltHouse(x: number, y: number, s: number) {
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="#4a2a12">
    <path d="M-80 0V60M-40 0V64M0 0V66M40 0V64M80 0V60" stroke="#4a2a12" stroke-width="6"/>
    <rect x="-92" y="-8" width="184" height="10"/>
    <rect x="-74" y="-50" width="148" height="44" fill="#9a6a38"/>
    <rect x="-14" y="-40" width="28" height="34" fill="#4a2a12"/>
    <path d="M-150 -86Q-120 -60 -100 -48Q0 -30 100 -48Q120 -60 150 -86Q130 -64 96 -62Q0 -118 -96 -62Q-130 -64 -150 -86Z" fill="#6b4220"/>
    <path d="M-96 -62Q0 -118 96 -62" fill="none" stroke="#3a200c" stroke-width="4"/>
    <path d="M20 2L40 64M34 2L54 64M24 16H44M28 30H48M32 44H52" stroke="#4a2a12" stroke-width="4"/>
  </g>`;
}

function landscape() {
  let terraces = '';
  const greens = ['#b7c25c', '#a2b04c', '#c3c96a', '#97a646'];
  for (let i = 0; i < 6; i++) {
    const y = 724 + i * 34;
    terraces += `<path d="M0 ${y}C400 ${y - 24} 900 ${y + 18} 1600 ${y - 10}V900H0Z" fill="${greens[i % 4]}"/>
      <path d="M0 ${y}C400 ${y - 24} 900 ${y + 18} 1600 ${y - 10}" fill="none" stroke="#7d8a38" stroke-width="2.5" opacity="0.7"/>`;
  }
  let ripples = '';
  const r = rng(5);
  for (let i = 0; i < 26; i++) {
    const x = r() * 1600;
    const y = 662 + r() * 50;
    ripples += `<line x1="${x.toFixed(0)}" y1="${y.toFixed(0)}" x2="${(x + 20 + r() * 40).toFixed(0)}" y2="${y.toFixed(0)}" stroke="#e6f1e2" stroke-width="2.5" stroke-linecap="round" opacity="0.55"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e9a862"/><stop offset="0.45" stop-color="#f5d293"/><stop offset="0.75" stop-color="#fbe6b8"/>
    </linearGradient>
    <radialGradient id="glow"><stop offset="0" stop-color="#fff0b8" stop-opacity="0.9"/><stop offset="1" stop-color="#fff0b8" stop-opacity="0"/></radialGradient>
    <linearGradient id="river" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9cc3b4"/><stop offset="1" stop-color="#6e9f94"/></linearGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.55" stop-color="#2a1205" stop-opacity="0"/><stop offset="1" stop-color="#2a1205" stop-opacity="0.45"/></linearGradient>
  </defs>
  <rect width="1600" height="900" fill="url(#sky)"/>
  ${drumSun(1180, 230)}
  ${bird(300, 170, 1.4)}${bird(370, 140, 1)}${bird(250, 120, 0.8)}${bird(860, 110, 1.1)}${bird(920, 150, 0.7)}
  ${karst(3, 600, 140, 300, '#e0b88e', 0.9)}
  ${karst(9, 636, 90, 220, '#b59c74')}
  ${karst(21, 662, 50, 140, '#7d7f4c')}
  <rect x="0" y="652" width="1600" height="72" fill="url(#river)"/>
  ${ripples}
  <g transform="translate(980 690)" fill="#3a200c">
    <path d="M-70 0Q0 22 74 -2L64 -8Q0 8 -60 -6Z"/>
    <path d="M-10 -6V-40M-10 -40L18 -6" stroke="#3a200c" stroke-width="3" fill="none"/>
    <circle cx="-30" cy="-16" r="7"/><path d="M-38 -8H-22V-2H-38Z"/>
  </g>
  ${terraces}
  ${stiltHouse(240, 680, 1)}
  ${stiltHouse(1430, 700, 0.75)}
  <rect width="1600" height="900" fill="url(#shade)"/>
</svg>`;
}

/** Đông Sơn band: concentric circles joined by tangent lines. */
const MOTIF = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="16" viewBox="0 0 28 16">
  <g fill="none" stroke="#f3d48a" stroke-width="1.6">
    <circle cx="14" cy="8" r="5"/><circle cx="14" cy="8" r="1.6" fill="#f3d48a"/>
    <path d="M14 3L28 8M0 8L14 13"/>
  </g></svg>`;

const svgUrl = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg.replace(/\s+/g, ' '))}")`;

/** Bronze corner flourish for card frames, drawn for the top-left corner and rotated for the others. */
function corner(rotate: number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">
  <g transform="rotate(${rotate} 13 13)" fill="none" stroke="#ffe2a0" stroke-width="2" stroke-linecap="round" opacity="0.9">
    <path d="M3 22V8Q3 3 8 3H22"/><path d="M8 14V10Q8 8 10 8H14"/>
    <circle cx="13" cy="13" r="1.8" fill="#ffe2a0" stroke="none"/>
  </g></svg>`;
}

export function applyTheme() {
  const root = document.documentElement.style;
  root.setProperty('--landscape', svgUrl(landscape()));
  root.setProperty('--motif', svgUrl(MOTIF));
  root.setProperty('--corner-tl', svgUrl(corner(0)));
  root.setProperty('--corner-tr', svgUrl(corner(90)));
  root.setProperty('--corner-br', svgUrl(corner(180)));
  root.setProperty('--corner-bl', svgUrl(corner(270)));
}

const icon = (body: string) => `<svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true">${body}</svg>`;

export const MODE_ICONS = {
  /** nỏ thần */
  pvp: icon(`
    <path d="M32 14V60" stroke="#7a4a22" stroke-width="7" stroke-linecap="round"/>
    <path d="M7 30Q32 8 57 30" fill="none" stroke="#4a2a12" stroke-width="5" stroke-linecap="round"/>
    <path d="M7 30L32 38L57 30" fill="none" stroke="#a88a5a" stroke-width="2"/>
    <path d="M32 38V8" stroke="#c07a2a" stroke-width="3"/>
    <path d="M32 2L26 13H38Z" fill="#d89a3a" stroke="#4a2a12" stroke-width="1.5"/>
    <rect x="28" y="44" width="8" height="6" rx="1.5" fill="#d89a3a"/>`),
  /** bù nhìn rơm for practice */
  bots: icon(`
    <path d="M32 40V62" stroke="#6b4220" stroke-width="5" stroke-linecap="round"/>
    <path d="M10 36H54" stroke="#6b4220" stroke-width="5" stroke-linecap="round"/>
    <path d="M23 32H41L45 52H19Z" fill="#d8a84a" stroke="#6b4220" stroke-width="2"/>
    <path d="M10 36l-5 -4M10 36l-5 4M54 36l5 -4M54 36l5 4" stroke="#c8962e" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="32" cy="26" r="7" fill="#e8c878" stroke="#6b4220" stroke-width="2"/>
    <path d="M12 22L32 6L52 22Z" fill="#efd796" stroke="#6b4220" stroke-width="2" stroke-linejoin="round"/>`),
  /** nhà sàn where the group gathers */
  private: icon(`
    <path d="M16 40V60M28 40V60M40 40V60M50 40V58" stroke="#4a2a12" stroke-width="3.5"/>
    <rect x="12" y="38" width="42" height="4" fill="#4a2a12"/>
    <rect x="16" y="24" width="34" height="15" fill="#b5844a" stroke="#4a2a12" stroke-width="2"/>
    <rect x="28" y="28" width="8" height="11" fill="#4a2a12"/>
    <path d="M2 12Q8 20 12 24Q32 28 54 24Q58 20 62 12Q56 18 50 18Q32 2 14 18Q8 18 2 12Z" fill="#7a4a22" stroke="#3a200c" stroke-width="2" stroke-linejoin="round"/>
    <path d="M44 42L52 60M50 42L58 60" stroke="#6b4220" stroke-width="2.5"/>`),
  /** straw target on a wooden stand */
  training: icon(`
    <path d="M20 44L12 62M44 44L52 62M32 46V62" stroke="#6b4220" stroke-width="4" stroke-linecap="round"/>
    <circle cx="32" cy="28" r="22" fill="#e8c878" stroke="#6b4220" stroke-width="3"/>
    <circle cx="32" cy="28" r="15" fill="#b8402a" stroke="#6b4220" stroke-width="2"/>
    <circle cx="32" cy="28" r="9" fill="#efd796" stroke="#6b4220" stroke-width="2"/>
    <circle cx="32" cy="28" r="4" fill="#b8402a"/>
    <path d="M56 6L34 26" stroke="#4a2a12" stroke-width="3" stroke-linecap="round"/>
    <path d="M56 6l-8 1M56 6l-1 8" stroke="#c07a2a" stroke-width="3" stroke-linecap="round"/>`),
};
