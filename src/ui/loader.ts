/** Loading indicator: a chibi Văn Lang warrior (Đông Sơn feather crown, sun disc, loincloth, bronze spear) walking in place. */

/** Outlined limb: a dark stroke under a skin-coloured one; the round caps double as hands. */
const limb = (d: string, back = false) => `<path class="w-o" d="${d}"/><path class="w-s${back ? ' back' : ''}" d="${d}"/>`;

const leg = (back = false) => `${limb('M58 82V99', back)}<ellipse class="w-foot${back ? ' back' : ''}" cx="61.5" cy="101.5" rx="6.2" ry="3.6"/>`;

/** Fan of feathers rising up and back from the headband, as on the Đông Sơn drum warriors. */
const FEATHERS = [-74, -52, -30, -8, 14]
  .map(
    (a, i) => `<g transform="translate(54 29) rotate(${a})" class="f${i % 2}">
      <path d="M0 0C-5 -9 -5 -25 0 -33C5 -25 5 -9 0 0Z"/><path class="rib" d="M0 -3V-29"/></g>`,
  )
  .join('');

const WALKER_SVG = `<svg viewBox="0 0 120 112" aria-hidden="true">
  <line class="w-ground" x1="8" y1="106" x2="112" y2="106"/>
  <ellipse class="w-shadow" cx="60" cy="105.5" rx="18" ry="3"/>
  <g class="w-body">
    <g class="w-leg w-leg-b">${leg(true)}</g>
    <g class="w-arm w-arm-b">${limb('M57 63V78', true)}</g>
    <g class="w-plume">${FEATHERS}</g>
    <rect class="w-torso" x="48.5" y="55" width="20" height="30" rx="9.5"/>
    <g class="w-leg w-leg-a">${leg()}</g>
    <path class="w-belt" d="M48.8 76.5H68.2V82H48.8Z"/>
    <path class="w-flap" d="M55 81H64L62.5 94Q59.5 96 56.5 94Z"/>
    <circle class="w-disc" cx="61" cy="66" r="4.6"/><circle class="w-disc-in" cx="61" cy="66" r="1.6"/>
    <circle class="w-head" cx="60" cy="39" r="15"/>
    <path class="w-hair" d="M45.4 43Q43 24 60 23.6Q72.5 23.6 75 32.5Q63 29 53.5 34.5Q50.5 40 52.5 47.5Q47 47 45.4 43Z"/>
    <circle class="w-hair" cx="45" cy="33" r="5"/>
    <path class="w-band-o" d="M45.6 34.5Q60 26.5 74.6 32.6"/><path class="w-band" d="M45.6 34.5Q60 26.5 74.6 32.6"/>
    <ellipse class="w-blush" cx="66.5" cy="46" rx="2.8" ry="1.7"/>
    <circle class="w-eye" cx="67.4" cy="40.5" r="2.3"/><circle class="w-glint" cx="68.2" cy="39.7" r="0.8"/>
    <path class="w-mouth" d="M69.5 47.5Q71.5 48.5 73 47"/>
    <g class="w-arm w-arm-a">
      <line class="w-spear-o" x1="83" y1="34" x2="78" y2="104"/><line class="w-spear" x1="83" y1="34" x2="78" y2="104"/>
      <path class="w-tassel" d="M82.8 36.5l-3.5 7M82.8 36.5l-0.6 8M82.8 36.5l3.4 6.6"/>
      <path class="w-tip" d="M83.8 16.5C87.6 23 87.6 30 83.3 36C79.4 30 79.6 23 83.8 16.5Z"/><path class="w-tip-rib" d="M83.6 21V33"/>
      ${limb('M59 63L65 73L80.5 71.5')}
    </g>
  </g>
</svg>`;

export function walker(label = 'Đang tải'): string {
  return `<div class="walker" role="status" aria-label="${label}">${WALKER_SVG}</div>`;
}
