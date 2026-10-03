import type { RosterEntry } from '../shared';

/** One colour per teammate, shared by their outline, name, minimap dot and HUD row. */
const MATE_COLORS = ['#4fd2ff', '#7dff7a', '#ff8fd8'];
/** The player's own map marker, matching their arrow on the minimap. */
export const OWN_MARKER_COLOR = '#ffd34d';

/** Teammates of `you` (never including you) mapped to their colour; empty outside team matches. */
export function mateColors(roster: readonly RosterEntry[], you: number): Map<number, string> {
  const mine = roster.find((r) => r.pid === you)?.team;
  const out = new Map<number, string>();
  if (mine === undefined) return out;
  for (const r of roster) {
    if (r.pid !== you && r.team === mine) out.set(r.pid, MATE_COLORS[out.size % MATE_COLORS.length]);
  }
  return out;
}

export const cssToNumber = (css: string) => parseInt(css.slice(1), 16);
