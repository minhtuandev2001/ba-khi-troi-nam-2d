import {
  AMMO_NAMES,
  AMMO_TYPES,
  BAG_CAPACITY,
  MAP_DEFS,
  MAX_HP,
  MODE_NAMES,
  SCOPE_VIEW_MULTIPLIER,
  TEAM_SIZE_NAMES,
  THROWABLE,
  TRAINING_MAP,
  WEAPONS,
  areaAt,
  ITEMS,
  isTeamSize,
  scopeName,
  weaponName,
  type AirdropNet,
  type LobbyNet,
  type TrainingStatsNet,
  type DeathMsg,
  type GameMap,
  type LeaderboardEntry,
  type MarkerNet,
  type MatchEndMsg,
  type RosterEntry,
  type ScopeLevel,
  type SelfNet,
  type SlotName,
  type TeammateNet,
  type ZoneNet,
} from '../shared';
import { esc, formatDuration, html } from '../ui/dom';
import { nameHtml } from '../ui/names';
import { bindSettings, guidePanel, keysPanel, settingsPanel } from '../ui/panels';
import { eyeGlyph, iconHtml, iconSvg, rarityCss, scopeGlyph, type IconId } from './icons';
import { MapRenderer, type MinimapState } from './Minimap';
import { OWN_MARKER_COLOR, mateColors } from './team';

export interface HudCallbacks {
  equip(slot: SlotName): void;
  drop(what: string): void;
  setScope(level: number): void;
  spectate(target: 'killer' | 'next'): void;
  leave(): void;
  /** Places the player's map marker; null removes it. */
  mark(at: { x: number; y: number } | null): void;
  /** Only for an admin watching the match: follow another player, or remove the one followed. */
  observe?: { step(dir: 1 | -1): void; kick(pid: number): void };
}

/** The kick button needs a second press within this time. */
const KICK_CONFIRM_MS = 3000;

type Overlay = 'none' | 'inventory' | 'map' | 'pause' | 'death' | 'end';

const SLOT_KEYS: Record<SlotName, string> = { p1: '1', p2: '2', pistol: 'E', melee: 'V', grenade: '3', smoke: '4' };
const GUN_SLOTS = ['p1', 'p2', 'pistol'] as const;
/** Walking along an area's edge would otherwise flash the banner on every crossing. */
const AREA_BANNER_COOLDOWN_MS = 4000;
/** Minimap shows the same world span on every map: this zoom on a map of the reference size. */
const MINIMAP_ZOOM = 3.2;
const MINIMAP_ZOOM_REF_SIZE = 4800;
/** How close (in big-map pixels) a click must land on your marker to remove it instead of moving it. */
const MARKER_HIT_PX = 18;

/** Snapshots arrive 15 times a second; skipping identical writes avoids needless style and layout work. */
function setText(el: HTMLElement, text: string) {
  if (el.textContent !== text) el.textContent = text;
}

const lineIcon = (paths: string) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const PAUSE_ICONS = {
  pause: lineIcon('<rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/>'),
  play: lineIcon('<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>'),
  settings: lineIcon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  keys: lineIcon('<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9"/>'),
  guide: lineIcon('<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z"/>'),
  leave: lineIcon('<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16l-4-4 4-4M6 12h10"/>'),
};

function scopeCell(level: number, active: boolean): string {
  const id = `scope${level}` as IconId;
  const scoped = level > 1;
  const bonus = Math.round((SCOPE_VIEW_MULTIPLIER[level as ScopeLevel] - 1) * 100);
  return `<div class="inv-cell scope-cell ${active ? 'active' : ''}" data-scope="${level}" style="--rarity:${scoped ? rarityCss(id) : '#b8c6d4'}">` +
    `<div class="inv-ic">${scoped ? iconSvg(id, 40) : eyeGlyph(26)}</div>` +
    `<div class="inv-text"><b>${scopeName(level)} x${level}</b>` +
    `<div class="muted">${scoped ? `Tầm nhìn +${bonus}%` : 'Tầm nhìn mặc định'}</div></div>` +
    `${scoped ? `<button class="btn small" data-drop="${id}">Vứt</button>` : ''}</div>`;
}

export class Hud {
  private readonly el: Record<string, HTMLElement> = {};
  private readonly mapRenderer: MapRenderer;
  private readonly minimap: HTMLCanvasElement;
  private overlay: Overlay = 'none';
  private bigMap: HTMLCanvasElement | null = null;
  private slotSig = '';
  private zoneHtml = '';
  private promptHtml: string | null = null;
  private invSig = '';
  private me: SelfNet | null = null;
  private zone: ZoneNet | null = null;
  private airdrops: AirdropNet[] = [];
  private ownMarker: { x: number; y: number } | null = null;
  private lastMinimap = 0;
  private centerTimer = 0;
  private area = '';
  private lastBanner = 0;
  private deathInfo: DeathMsg | null = null;
  private dead = false;
  private scopeActive = 0;
  private scopeIndex = 0;
  private scopeOwned = '';
  private readonly scopeChips = new Map<number, HTMLElement>();
  private readonly training: boolean;
  private readonly mates: Map<number, string>;
  /** Teams at the start of the match (the player count in solo). */
  private readonly teamCount: number;
  private readonly mateRows = new Map<number, HTMLElement>();
  private mateAlive = false;
  private trainingStats: TrainingStatsNet | null = null;
  private inLobby = false;
  private pressing = false;
  private readonly onRelease = () => {
    if (!this.pressing) return;
    this.pressing = false;
    // let the click land on the button that was pressed before swapping the markup
    setTimeout(() => {
      if (this.overlay === 'inventory') this.renderInventoryPanel(false);
    }, 0);
  };

  constructor(
    private readonly root: HTMLElement,
    private readonly map: GameMap,
    private readonly roster: RosterEntry[],
    private readonly you: number,
    private readonly cb: HudCallbacks,
  ) {
    this.training = map.id === TRAINING_MAP;
    this.mates = mateColors(roster, you);
    this.teamCount = new Set(roster.map((r) => r.team ?? r.pid)).size;
    root.innerHTML = `
      <div class="hud-top-left"><div class="hud-pill" id="h-alive">👤 0</div><div class="hud-pill" id="h-kills">💀 0</div></div>
      <div class="hud-team hidden" id="h-team"></div>
      <div class="hud-zone" id="h-zone">Đang tải…</div>
      <div class="lobby-panel hidden" id="h-lobby">
        <small>🏯 Phòng chờ</small>
        <div class="lobby-count"><span id="h-lobbytime"></span></div>
        <div class="lobby-note">Chưa có vật phẩm, không ai gây được sát thương. Hết giờ mọi người được đưa tới điểm xuất phát.</div>
      </div>
      <button class="btn small pause-btn" id="h-pause" title="Tạm dừng (Esc)">⏸</button>
      <div class="hud-top-right">
        <div class="minimap-wrap">
          <canvas class="minimap interactive" id="h-minimap" width="170" height="170" title="Bản đồ (M)"></canvas>
          <div class="hud-area" id="h-area"></div>
        </div>
        <div class="hud-scope interactive" id="h-scope" title="Chim trinh sát (Z)"><span class="glyph">${scopeGlyph(18)}</span><div class="scope-track" id="h-scopetrack"><div class="scope-ind"></div></div><span class="kbd">Z</span></div>
        <div class="killfeed" id="h-feed"></div>
      </div>
      <div class="area-banner" id="h-banner"></div>
      <div class="center-msg" id="h-center"></div>
      <div class="prompt hidden" id="h-prompt"></div>
      <div class="hud-inv" id="h-inv"></div>
      <div class="spectate-bar hidden" id="h-spec"></div>
      <div class="hud-bottom" id="h-bottom">
        <div id="h-progress" class="hidden"><div class="progress-label"></div><div class="progress"><div></div></div></div>
        <div class="bars"><div class="hpbar"><div class="fill" id="h-hp"></div><span id="h-hptext"></span></div><div class="armorbar"><div id="h-armor"></div></div></div>
        <div class="slots" id="h-slots"></div>
      </div>
      <div class="hurt-flash" id="h-hurt"></div>
      <div class="zone-outside hidden" id="h-outside"></div>
      <div class="scope-fx" id="h-scopefx"></div>
      <div class="fps hidden" id="h-fps"></div>
      <div id="h-overlay"></div>`;
    root.classList.remove('hidden');
    for (const n of root.querySelectorAll<HTMLElement>('[id^="h-"]')) this.el[n.id.slice(2)] = n;
    this.mapRenderer = new MapRenderer(map);
    this.minimap = this.el.minimap as HTMLCanvasElement;
    this.minimap.addEventListener('click', () => this.toggle('map'));
    this.el.pause.addEventListener('click', () => this.toggle('pause'));
    this.el.overlay.addEventListener('pointerdown', () => (this.pressing = true));
    window.addEventListener('pointerup', this.onRelease);
    window.addEventListener('pointercancel', this.onRelease);
    this.el.slots.addEventListener('click', (e) => {
      const slot = (e.target as HTMLElement).closest<HTMLElement>('[data-slot]')?.dataset.slot as SlotName | undefined;
      if (slot) this.cb.equip(slot);
    });
    this.el.scope.addEventListener('click', (e) => {
      const level = (e.target as HTMLElement).closest<HTMLElement>('[data-scope]')?.dataset.scope;
      if (level) this.cb.setScope(Number(level));
    });
  }

  /** Called every snapshot and on local choices; touches the DOM only when something changed. */
  renderScope(active: number, owned: readonly number[], enabled: boolean) {
    this.el.scope.classList.toggle('disabled', !enabled);
    const track = this.el.scopetrack;
    const sig = owned.join();
    if (sig !== this.scopeOwned) {
      const animate = this.scopeOwned !== '';
      this.scopeOwned = sig;
      for (const [level, chip] of this.scopeChips) {
        if (owned.includes(level)) continue;
        chip.remove();
        this.scopeChips.delete(level);
      }
      owned.forEach((level, i) => {
        let chip = this.scopeChips.get(level);
        if (!chip) {
          chip = html(`<div class="scope-chip${animate ? ' new' : ''}" data-scope="${level}">x${level}</div>`);
          this.scopeChips.set(level, chip);
        }
        chip.classList.toggle('active', level === active);
        // child 0 is the sliding indicator; only misplaced chips move, so their entry animation isn't replayed
        const at = track.children[i + 1] ?? null;
        if (at !== chip) track.insertBefore(chip, at);
      });
    }
    const index = Math.max(0, owned.indexOf(active));
    if (index !== this.scopeIndex) {
      this.scopeIndex = index;
      track.style.setProperty('--i', String(index));
    }
    if (active === this.scopeActive) return;
    this.scopeChips.get(this.scopeActive)?.classList.remove('active');
    this.scopeChips.get(active)?.classList.add('active');
    if (this.scopeActive !== 0 && enabled) {
      this.el.scopefx.animate([{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], { duration: 420, easing: 'ease-out' });
    }
    this.scopeActive = active;
    if (this.overlay !== 'inventory') return;
    for (const cell of this.el.overlay.querySelectorAll<HTMLElement>('.scope-cell')) cell.classList.toggle('active', cell.dataset.scope === String(active));
  }

  get blocking(): boolean {
    return this.overlay === 'inventory' || this.overlay === 'pause' || this.overlay === 'map';
  }

  get current(): Overlay {
    return this.overlay;
  }

  /** Escaped name of a player, styled when it is an admin. */
  private nameTag(pid: number): string {
    const r = this.roster.find((e) => e.pid === pid);
    return nameHtml(r?.name ?? '???', r?.admin, false);
  }

  setTrainingStats(stats: TrainingStatsNet) {
    this.trainingStats = stats;
  }

  /** Countdown of the pre-match waiting area; null hides it. */
  setLobby(lb: LobbyNet | null) {
    const open = lb !== null;
    if (open !== this.inLobby) {
      this.inLobby = open;
      this.el.lobby.classList.toggle('hidden', !open);
      this.el.zone.classList.toggle('hidden', open);
      this.placeObserverBar();
    }
    if (!lb) return;
    const secs = Math.ceil(lb[0] / 1000);
    setText(this.el.lobbytime, `Vào trận sau ${secs}s`);
    this.el.lobby.classList.toggle('urgent', secs <= 5);
  }

  /** Teammate list under the top-left pills: rows are built once, then only health and state change. */
  private renderTeam(mates: TeammateNet[]) {
    const box = this.el.team;
    box.classList.toggle('hidden', !mates.length);
    this.mateAlive = mates.some((m) => m[4] === 1);
    for (const [pid, , , hp, alive, away] of mates) {
      let row = this.mateRows.get(pid);
      if (!row) {
        const r = this.roster.find((e) => e.pid === pid);
        row = html(`<div class="mate" style="--mate:${this.mates.get(pid) ?? '#fff'}">
          <span class="mate-av">${esc(r?.avatar ?? '?')}</span>
          <div class="mate-info"><b>${nameHtml(r?.name ?? '???', r?.admin, false)}</b><div class="mate-hp"><div></div></div></div>
          <span class="mate-state"></span></div>`);
        this.mateRows.set(pid, row);
        box.appendChild(row);
      }
      row.classList.toggle('dead', !alive);
      row.classList.toggle('away', !!alive && !!away);
      row.querySelector<HTMLElement>('.mate-hp > div')!.style.width = `${alive ? hp : 0}%`;
      setText(row.querySelector<HTMLElement>('.mate-state')!, !alive ? '☠' : away ? '📶' : '');
    }
  }

  update(
    me: SelfNet, alive: number, zone: ZoneNet, airdrops: AirdropNet[], spectating: boolean, x: number, y: number,
    team: { mates: TeammateNet[]; teams: number } | null = null,
    markerList: MarkerNet[] = [],
  ) {
    this.me = me;
    this.zone = zone;
    this.airdrops = airdrops;
    setText(this.el.alive, this.training ? '🎯 Tập bắn' : team ? `👤 ${alive} · 👥 ${team.teams} đội` : `👤 ${alive}`);
    if (team) this.renderTeam(team.mates);
    const mates = team?.mates
      .filter((m) => this.mates.has(m[0]))
      .map(([pid, mx, my, , mAlive]) => ({ x: mx, y: my, color: this.mates.get(pid)!, alive: mAlive === 1 }));
    this.ownMarker = null;
    const markers: NonNullable<MinimapState['markers']> = [];
    for (const [pid, mx, my] of markerList) {
      if (pid === this.you) {
        this.ownMarker = { x: mx, y: my };
        // while spectating the map is centred on someone else, so there is no line back to you
        markers.push({ x: mx, y: my, color: OWN_MARKER_COLOR, from: spectating ? null : { x, y } });
        continue;
      }
      const mate = team?.mates.find((m) => m[0] === pid);
      const color = this.mates.get(pid);
      if (!color) continue;
      markers.push({ x: mx, y: my, color, from: mate && mate[4] === 1 ? { x: mate[1], y: mate[2] } : null });
    }
    this.el.overlay.querySelector<HTMLButtonElement>('[data-a="unmark"]')?.toggleAttribute('disabled', !this.ownMarker);
    setText(this.el.kills, this.training ? `🐗 ${me.kills}` : `💀 ${me.kills}`);

    const [, , , , , , phase, stage, left, dps] = zone;
    const label = stage === 'wait' ? `Bo ${phase} thu nhỏ sau` : stage === 'shrink' ? `Bo ${phase} đang thu nhỏ` : 'Bo cuối';
    const outside = !this.training && Math.hypot(x - zone[0], y - zone[1]) > zone[2];
    const tr = this.trainingStats;
    const zoneHtml = this.training
      ? tr
        ? `Trúng <b>${tr.hits}/${tr.shots}</b> (${tr.shots ? Math.round((tr.hits / tr.shots) * 100) : 0}%) · Hạ <b>${tr.kills}</b> · Xa nhất <b>${tr.best}</b>`
        : 'Trường tập bắn'
      : `${label} <b>${stage === 'done' ? '' : formatDuration(left)}</b>${outside ? ` <span class="warn">· Ngoài bo −${dps}/s</span>` : ''}`;
    if (zoneHtml !== this.zoneHtml) {
      this.zoneHtml = zoneHtml;
      this.el.zone.innerHTML = zoneHtml;
    }
    this.el.outside.classList.toggle('hidden', !outside || !me.alive);

    const hpPct = Math.max(0, (me.hp / MAX_HP) * 100);
    this.el.hp.style.width = `${hpPct}%`;
    this.el.hp.classList.toggle('low', hpPct < 30);
    setText(this.el.hptext, `${Math.ceil(me.hp)} / ${MAX_HP}`);
    const armorMax = me.armor ? [0, 60, 90, 130][me.armor] : 1;
    this.el.armor.style.width = `${me.armor ? (me.armorDur / armorMax) * 100 : 0}%`;

    const prog = this.el.progress;
    prog.classList.toggle('fuse', me.fuseLeft > 0);
    if (me.fuseLeft > 0) {
      prog.classList.remove('hidden');
      prog.classList.toggle('urgent', me.fuseLeft < 1000);
      setText(prog.querySelector<HTMLElement>('.progress-label')!, `🔥 Hũ lửa nổ sau ${(me.fuseLeft / 1000).toFixed(1)}s, ném ngay!`);
      prog.querySelector<HTMLElement>('.progress > div')!.style.width = `${(me.fuseLeft / THROWABLE.grenade.fuseMs) * 100}%`;
    } else if (me.reloadLeft > 0 || me.healLeft > 0) {
      const healing = me.healLeft > 0;
      const left = healing ? me.healLeft : me.reloadLeft;
      const gun = me.active === 'p1' || me.active === 'p2' || me.active === 'pistol' ? me[me.active] : null;
      const total = healing ? 3000 : gun ? WEAPONS[gun.w].reloadMs : 1000;
      const label = healing ? 'Đang đắp thuốc nam' : gun?.w === 'pistol' ? 'Đang nạp kim' : 'Đang nạp tên';
      prog.classList.remove('hidden');
      setText(prog.querySelector<HTMLElement>('.progress-label')!, `${label} ${(left / 1000).toFixed(1)}s`);
      prog.querySelector<HTMLElement>('.progress > div')!.style.width = `${(1 - left / total) * 100}%`;
    } else {
      prog.classList.add('hidden');
    }

    this.renderSlots(me);
    this.renderInventorySummary(me);
    if (this.overlay === 'inventory') this.renderInventoryPanel(false);

    const now = performance.now();
    if (now - this.lastMinimap > 150) {
      this.lastMinimap = now;
      const state: MinimapState = { x, y, a: me.a, zone, airdrops, mates, markers };
      this.mapRenderer.draw(this.minimap, state, { zoom: MINIMAP_ZOOM * this.map.size / MINIMAP_ZOOM_REF_SIZE });
      if (this.bigMap) this.mapRenderer.draw(this.bigMap, state, { grid: true, labels: true });
      this.updateArea(x, y, now);
    }

    this.el.spec.classList.toggle('hidden', !spectating || this.overlay === 'death' || this.overlay === 'end');
    if (this.cb.observe) {
      this.renderObserverBar(me.pid);
    } else if (spectating) {
      // while a teammate is alive the server only lets the dead watch their own team
      const watchingMate = this.mateAlive;
      const sig = `spec-${me.pid}-${watchingMate}`;
      if (this.el.spec.dataset.sig !== sig) {
        this.el.spec.dataset.sig = sig;
        this.el.spec.innerHTML = `<span>Đang xem${watchingMate ? ' đồng đội' : ''}: <b${this.mates.has(me.pid) ? ` style="color:${this.mates.get(me.pid)}"` : ''}>${this.nameTag(me.pid)}</b></span>
          <button class="btn small" data-a="next">${watchingMate ? 'Đồng đội tiếp theo' : 'Người tiếp theo'}</button>
          <button class="btn small danger" data-a="leave">Về sảnh</button>`;
        this.el.spec.querySelector('[data-a="next"]')!.addEventListener('click', () => this.cb.spectate('next'));
        this.el.spec.querySelector('[data-a="leave"]')!.addEventListener('click', () => this.cb.leave());
      }
    }
    this.el.bottom.style.opacity = spectating ? '0.75' : '1';
  }

  /** The observer bar shares the top centre with the waiting-area panel, so it moves below it while that is open. */
  private placeObserverBar() {
    if (!this.cb.observe) return;
    const bar = this.el.spec;
    if (!this.inLobby) {
      bar.style.top = '';
      return;
    }
    const panel = this.el.lobby.getBoundingClientRect();
    bar.style.top = `${Math.round(panel.bottom - this.root.getBoundingClientRect().top + 8)}px`;
  }

  /** Admin observer controls; rebuilt when the followed player changes, so a kick always targets who is on screen. */
  private renderObserverBar(pid: number) {
    const obs = this.cb.observe!;
    const bar = this.el.spec;
    const sig = `obs-${pid}`;
    if (bar.dataset.sig === sig) return;
    bar.dataset.sig = sig;
    bar.classList.add('observer-bar');
    const name = this.nameTag(pid);
    bar.innerHTML = `<span class="observer-tag">🛡️ Quản trị · chỉ xem</span>
      <span>Đang xem: <b>${name}</b></span>
      <span class="observer-nav">
        <button class="btn small" data-a="prev" title="Người trước (← / A)" aria-label="Người trước">◀</button>
        <button class="btn small" data-a="next" title="Người sau (→ / D)" aria-label="Người sau">▶</button>
      </span>
      <button class="btn small danger" data-a="kick">🚫 Kích khỏi trận</button>
      <button class="btn small" data-a="leave">Rời xem</button>`;
    this.placeObserverBar();
    bar.querySelector('[data-a="prev"]')!.addEventListener('click', () => obs.step(-1));
    bar.querySelector('[data-a="next"]')!.addEventListener('click', () => obs.step(1));
    bar.querySelector('[data-a="leave"]')!.addEventListener('click', () => this.cb.leave());
    const kick = bar.querySelector<HTMLButtonElement>('[data-a="kick"]')!;
    let armed = 0;
    kick.addEventListener('click', () => {
      if (armed) {
        clearTimeout(armed);
        kick.disabled = true;
        obs.kick(pid);
        return;
      }
      kick.innerHTML = `Bấm lần nữa để kích <b>${name}</b>`;
      kick.classList.add('armed');
      armed = window.setTimeout(() => {
        armed = 0;
        kick.textContent = '🚫 Kích khỏi trận';
        kick.classList.remove('armed');
      }, KICK_CONFIRM_MS);
    });
  }

  private renderSlots(me: SelfNet) {
    const sig = JSON.stringify([me.p1?.w, me.p2?.w, me.pistol?.w, me.melee, me.active, me.gren, me.smoke]);
    if (sig !== this.slotSig) {
      this.slotSig = sig;
      this.buildSlots(me);
    }
    // ammo changes with every shot, so only the counters are touched
    for (const slot of GUN_SLOTS) {
      const s = me[slot];
      if (!s) continue;
      const a = this.el.slots.querySelector<HTMLElement>(`[data-slot="${slot}"] .a`);
      if (a) setText(a, `${s.mag} / ${me.ammo[WEAPONS[s.w].ammo!]}`);
    }
  }

  private buildSlots(me: SelfNet) {
    const gun = (slot: 'p1' | 'p2' | 'pistol') => {
      const s = me[slot];
      if (!s) return `<div class="slot empty" data-slot="${slot}"><span class="k">${SLOT_KEYS[slot]}</span><div class="si"></div><div class="n">${slot === 'pistol' ? WEAPONS.pistol.name : 'Trống'}</div><div class="a">&nbsp;</div></div>`;
      const def = WEAPONS[s.w];
      return `<div class="slot ${me.active === slot ? 'active' : ''}" data-slot="${slot}"><span class="k">${SLOT_KEYS[slot]}</span><div class="si">${iconSvg(s.w, 30)}</div><div class="n">${esc(def.name)}</div><div class="a"></div></div>`;
    };
    const simple = (slot: SlotName, icon: IconId, name: string, count: string, empty: boolean) =>
      `<div class="slot ${me.active === slot ? 'active' : ''} ${empty ? 'empty' : ''}" data-slot="${slot}"><span class="k">${SLOT_KEYS[slot]}</span><div class="si">${iconSvg(icon, 30)}</div><div class="n">${name}</div><div class="a">${count}</div></div>`;
    this.el.slots.innerHTML =
      gun('p1') + gun('p2') + gun('pistol') +
      simple('melee', me.melee, WEAPONS[me.melee].name, '&nbsp;', false) +
      simple('grenade', 'grenade', ITEMS.grenade.name, `×${me.gren}`, me.gren === 0) +
      simple('smoke', 'smoke', ITEMS.smoke.name, `×${me.smoke}`, me.smoke === 0);
  }

  private renderInventorySummary(me: SelfNet) {
    const sig = JSON.stringify([me.ammo, me.med, me.armor, me.armorDur, me.bag]);
    if (sig === this.invSig) return;
    this.invSig = sig;
    const cap = BAG_CAPACITY[me.bag];
    const row = (icon: IconId, text: string) => `<div>${iconHtml(icon, 20)}<span>${text}</span></div>`;
    this.el.inv.innerHTML =
      row(me.armor ? (`armor${me.armor}` as IconId) : 'armor1', me.armor ? `${ITEMS[`armor${me.armor}`].name} (${me.armorDur})` : 'Chưa có giáp') +
      row(me.bag ? (`bag${me.bag}` as IconId) : 'bag1', me.bag ? ITEMS[`bag${me.bag}`].name : 'Chưa có gùi') +
      row('medkit', `${ITEMS.medkit.name}: ${me.med}/${cap.medkit} <span class="kbd">Q</span>`) +
      AMMO_TYPES.map((t) => row(`ammo_${t}`, `${AMMO_NAMES[t]}: ${me.ammo[t]}/${cap.ammo[t]}`)).join('');
  }

  feed(htmlText: string, mine = false) {
    const row = html(`<div class="${mine ? 'me' : ''}">${htmlText}</div>`);
    this.el.feed.prepend(row);
    while (this.el.feed.children.length > 6) this.el.feed.lastElementChild?.remove();
    setTimeout(() => row.remove(), 7000);
  }

  killFeed(killer: number, victim: number, weapon: string) {
    const v = `<b>${this.nameTag(victim)}</b>`;
    const mine = killer === this.you || victim === this.you;
    if (weapon === 'zone') this.feed(`${v} đã chết ngoài vòng bo`, mine);
    else if (weapon === 'leave') this.feed(`${v} đã rời trận`, mine);
    else if (weapon === 'kick') this.feed(`🚫 ${v} đã bị admin kích khỏi map`, mine);
    else if (killer < 0 || killer === victim) this.feed(`${v} đã tự hạ gục mình`, mine);
    else this.feed(`<b>${this.nameTag(killer)}</b> <span class="weapon">[${esc(weaponName(weapon))}]</span> ${v}`, mine);
  }

  private updateArea(x: number, y: number, now: number) {
    const area = areaAt(this.map, x, y);
    // the banner would cover the waiting-area panel; the map's welcome banner waits for the real spawn
    if (this.inLobby) return setText(this.el.area, `📍 ${area}`);
    if (area === this.area) return;
    const first = this.area === '';
    this.area = area;
    setText(this.el.area, `📍 ${area}`);
    if (!first && now - this.lastBanner < AREA_BANNER_COOLDOWN_MS) return;
    this.lastBanner = now;
    const def = MAP_DEFS[this.map.id];
    this.el.banner.innerHTML = first
      ? `<small>${def.icon} ${esc(def.name)}</small>${esc(area)}`
      : esc(area);
    this.el.banner.classList.remove('show');
    void this.el.banner.offsetWidth;
    this.el.banner.classList.add('show');
  }

  center(text: string, ms = 2500) {
    this.el.center.textContent = text;
    clearTimeout(this.centerTimer);
    this.centerTimer = window.setTimeout(() => (this.el.center.textContent = ''), ms);
  }

  prompt(text: string | null) {
    if (text === this.promptHtml) return;
    this.promptHtml = text;
    this.el.prompt.classList.toggle('hidden', !text);
    if (text) this.el.prompt.innerHTML = text;
  }

  hurt() {
    this.el.hurt.style.opacity = '1';
    setTimeout(() => (this.el.hurt.style.opacity = '0'), 120);
  }

  fps(text: string | null) {
    this.el.fps.classList.toggle('hidden', !text);
    if (text) this.el.fps.textContent = text;
  }

  // ---------------------------------------------------------------- overlays

  toggle(o: 'inventory' | 'map' | 'pause') {
    if (this.overlay === 'death' || this.overlay === 'end') return;
    this.show(this.overlay === o ? 'none' : o);
  }

  closeOverlay() {
    if (this.overlay === 'death' || this.overlay === 'end') return;
    this.show('none');
  }

  private show(o: Overlay) {
    this.overlay = o;
    this.bigMap = null;
    const box = this.el.overlay;
    box.innerHTML = '';
    if (o === 'none') return;
    if (o === 'inventory') this.renderInventoryPanel(true);
    if (o === 'map') this.renderBigMap();
    if (o === 'pause') this.renderPause('menu');
  }

  private renderBigMap() {
    const size = Math.floor(Math.min(window.innerWidth * 0.94, window.innerHeight * 0.86 - 76));
    const def = MAP_DEFS[this.map.id];
    const who = this.mates.size ? 'cả đội cùng thấy' : 'chỉ mình bạn thấy';
    const wrap = html(`<div class="bigmap">
      <div class="bigmap-head">
        <div class="bigmap-title">${def.icon} ${esc(def.name)}</div>
        <button class="btn small" data-a="unmark" ${this.ownMarker ? '' : 'disabled'}>🚩 Gỡ cờ</button>
        <button class="btn small" data-a="close" title="Đóng (M / Esc)">✕</button>
      </div>
      <canvas width="${size}" height="${size}"></canvas>
      <div class="bigmap-hint">Bấm lên bản đồ để cắm cờ đánh dấu (${who}) · bấm lại vào cờ để gỡ</div>
    </div>`);
    const canvas = wrap.querySelector('canvas')!;
    canvas.addEventListener('click', (e) => this.clickBigMap(canvas, e));
    wrap.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (action === 'unmark') this.cb.mark(null);
      else if (action === 'close' || e.target === wrap) this.show('none');
    });
    this.el.overlay.appendChild(wrap);
    this.bigMap = canvas;
    this.lastMinimap = 0;
  }

  private clickBigMap(canvas: HTMLCanvasElement, e: MouseEvent) {
    e.stopPropagation();
    const r = canvas.getBoundingClientRect();
    const cx = e.clientX - r.left;
    const cy = e.clientY - r.top;
    const scale = r.width / this.map.size;
    const own = this.ownMarker;
    if (own) {
      // the banner stands above its foot, so aim the hit test at the middle of the drawing
      const u = Math.max(1, canvas.width / 260) * (r.width / canvas.width);
      const d = Math.hypot(own.x * scale + 3 * u - cx, own.y * scale - 8 * u - cy);
      if (d <= Math.max(MARKER_HIT_PX, 10 * u)) {
        this.cb.mark(null);
        this.lastMinimap = 0;
        return;
      }
    }
    this.cb.mark({ x: cx / scale, y: cy / scale });
    this.lastMinimap = 0;
  }

  private renderInventoryPanel(force: boolean) {
    const me = this.me;
    if (!me) return;
    const box = this.el.overlay;
    const sig = JSON.stringify([me.p1, me.p2, me.pistol, me.melee, me.armor, me.armorDur, me.bag, me.med, me.gren, me.smoke, me.ammo, me.scopes]);
    // replacing the markup mid-press would swallow the tap, so wait for the release
    if (!force && (box.dataset.sig === sig || this.pressing)) return;
    box.dataset.sig = sig;
    const cap = BAG_CAPACITY[me.bag];
    const cell = (icon: IconId, has: boolean, title: string, body: string, drop?: string) =>
      `<div class="inv-cell ${has ? '' : 'empty'}" style="--rarity:${rarityCss(icon)}">` +
      `<div class="inv-ic">${iconSvg(icon, 40)}</div>` +
      `<div class="inv-text"><b>${title}</b><div class="muted">${body}</div></div>` +
      `${drop ? `<button class="btn small" data-drop="${drop}">Vứt</button>` : ''}</div>`;
    const gun = (slot: 'p1' | 'p2' | 'pistol', label: string) => {
      const s = me[slot];
      const icon: IconId = s ? s.w : slot === 'pistol' ? 'pistol' : 'rifle';
      return cell(icon, !!s, label, s ? `${esc(WEAPONS[s.w].name)} · ${s.mag}/${WEAPONS[s.w].magSize}` : 'Trống', s ? slot : undefined);
    };
    const touch = document.body.classList.contains('touch-ui');
    box.innerHTML = `
      <div class="overlay ${touch ? 'side' : ''}"><div class="card inventory-panel">
        <div class="row between"><h2 class="with-icon">${iconHtml(me.bag ? (`bag${me.bag}` as IconId) : 'bag1', 34)} Túi đồ</h2><button class="btn small" data-close>${touch ? 'Đóng' : 'Đóng (Tab)'}</button></div>
        <div class="inv-grid">
          ${gun('p1', 'Vũ khí chính 1')}${gun('p2', 'Vũ khí chính 2')}${gun('pistol', WEAPONS.pistol.name)}
          ${cell(me.melee, true, 'Cận chiến', esc(WEAPONS[me.melee].name), me.melee !== 'fists' ? 'melee' : undefined)}
          ${cell(`armor${me.armor || 1}` as IconId, me.armor > 0, 'Giáp', me.armor ? `${ITEMS[`armor${me.armor}`].name} · độ bền ${me.armorDur}` : 'Không có', me.armor ? 'armor' : undefined)}
          ${cell(`bag${me.bag || 1}` as IconId, me.bag > 0, 'Gùi', me.bag ? ITEMS[`bag${me.bag}`].name : 'Không có', me.bag ? 'bag' : undefined)}
          ${cell('medkit', me.med > 0, ITEMS.medkit.name, `${me.med} / ${cap.medkit}`, me.med ? 'medkit' : undefined)}
          ${cell('grenade', me.gren > 0, ITEMS.grenade.name, `${me.gren} / ${cap.grenade}`, me.gren ? 'grenade' : undefined)}
          ${cell('smoke', me.smoke > 0, ITEMS.smoke.name, `${me.smoke} / ${cap.smoke}`, me.smoke ? 'smoke' : undefined)}
          ${AMMO_TYPES.map((t) => cell(`ammo_${t}`, me.ammo[t] > 0, AMMO_NAMES[t], `${me.ammo[t]} / ${cap.ammo[t]}`, me.ammo[t] ? `ammo_${t}` : undefined)).join('')}
        </div>
        <h3>Chim trinh sát <span class="muted">· bấm để đổi</span></h3>
        <div class="inv-grid scope-grid">${me.scopes.map((s) => scopeCell(s, s === this.scopeActive)).join('')}</div>
      </div></div>`;
    box.querySelector('[data-close]')?.addEventListener('click', () => this.show('none'));
    box.querySelectorAll<HTMLElement>('[data-drop]').forEach((b) => b.addEventListener('click', () => this.cb.drop(b.dataset.drop!)));
    box.querySelectorAll<HTMLElement>('[data-scope]').forEach((b) =>
      b.addEventListener('click', (e) => {
        if (!(e.target as HTMLElement).closest('[data-drop]')) this.cb.setScope(Number(b.dataset.scope));
      }),
    );
  }

  private renderPause(view: 'menu' | 'settings' | 'keys' | 'guide' | 'confirm') {
    const box = this.el.overlay;
    const back = `<button class="btn small" data-v="menu">← Quay lại</button>`;
    const touch = document.body.classList.contains('touch-ui');
    const def = MAP_DEFS[this.map.id];
    let body = '';
    let panel = 'inventory-panel';
    if (view === 'menu') {
      panel = 'pause-menu';
      const tile = (v: string, icon: string, label: string) =>
        `<button class="pause-tile" data-v="${v}"><span class="pause-tile-ic">${icon}</span>${label}</button>`;
      body = `
        <div class="pause-head">
          <div class="pause-badge">${PAUSE_ICONS.pause}</div>
          <h2>Tạm dừng</h2>
          <div class="pause-meta"><span>${def.icon} ${esc(def.name)}</span><span class="pause-live"><i></i>${this.training ? 'Buổi tập vẫn tiếp tục' : 'Trận vẫn đang diễn ra'}</span></div>
        </div>
        <button class="btn primary pause-resume" data-v="close">${PAUSE_ICONS.play}<span>Tiếp tục</span>${touch ? '' : '<kbd class="kbd">Esc</kbd>'}</button>
        <div class="pause-tiles">
          ${tile('settings', PAUSE_ICONS.settings, 'Cài đặt')}
          ${tile('keys', PAUSE_ICONS.keys, 'Phím tắt')}
          ${tile('guide', PAUSE_ICONS.guide, 'Hướng dẫn')}
        </div>
        <button class="pause-leave" data-v="${this.cb.observe ? 'leave' : 'confirm'}">${PAUSE_ICONS.leave}${this.cb.observe ? 'Rời xem trận' : this.training ? 'Rời trường bắn' : 'Thoát trận'}</button>`;
    } else if (view === 'settings') body = `<div class="row between"><h2>Cài đặt</h2>${back}</div>${settingsPanel()}`;
    else if (view === 'keys') body = `<div class="row between"><h2>Phím tắt</h2>${back}</div>${keysPanel()}`;
    else if (view === 'guide') body = `<div class="row between"><h2>Hướng dẫn</h2>${back}</div>${guidePanel()}`;
    else {
      panel = 'pause-menu pause-confirm';
      body = `
        <div class="pause-head">
          <div class="pause-badge danger">${PAUSE_ICONS.leave}</div>
          <h2>${this.training ? 'Rời trường bắn?' : 'Thoát trận?'}</h2>
        </div>
        <p>${this.training ? 'Bạn sẽ quay về sảnh. Thành tích tập bắn không được lưu lại.' : this.dead ? 'Bạn sẽ quay về sảnh.' : 'Nhân vật của bạn sẽ bị loại khỏi trận và tính là bị hạ gục.'}</p>
        <div class="row btn-pair"><button class="btn" data-v="menu">Ở lại</button><button class="btn danger" data-v="leave">Thoát</button></div>`;
    }
    box.innerHTML = `<div class="overlay"><div class="card ${panel}">${body}</div></div>`;
    if (view === 'settings') bindSettings(box);
    box.querySelectorAll<HTMLElement>('[data-v]').forEach((b) =>
      b.addEventListener('click', () => {
        const v = b.dataset.v!;
        if (v === 'close') this.show('none');
        else if (v === 'leave') this.cb.leave();
        else this.renderPause(v as 'menu');
      }),
    );
  }

  showDeath(msg: DeathMsg, killerAlive: boolean) {
    this.dead = true;
    this.deathInfo = msg;
    this.overlay = 'death';
    const total = this.teamCount;
    const teamGame = this.mates.size > 0;
    const how = msg.weapon === 'zone'
      ? 'Bạn đã chết ngoài vòng bo.'
      : msg.weapon === 'leave'
        ? 'Bạn đã rời trận.'
        : msg.killer >= 0 && msg.killer !== this.you
          ? `Bạn bị <b>${this.nameTag(msg.killer)}</b> hạ gục bằng <b>${esc(weaponName(msg.weapon))}</b>.`
          : 'Bạn đã tự hạ gục mình.';
    this.el.overlay.innerHTML = `
      <div class="overlay"><div class="card narrow center">
        <h2>☠️ Bạn đã bị loại</h2>
        ${msg.teamAlive
          ? '<div class="logo" style="font-size:26px">Đồng đội vẫn đang chiến đấu</div>'
          : `<div class="logo" style="font-size:40px">#${msg.placement} <span class="muted" style="font-size:20px">/ ${total}${teamGame ? ' đội' : ''}</span></div>`}
        <p>${how}</p>
        <div class="grid cols-3">
          <div class="stat"><div class="v">${msg.kills}</div><div class="l">Hạ gục</div></div>
          <div class="stat"><div class="v">${msg.damage}</div><div class="l">Sát thương</div></div>
          <div class="stat"><div class="v">${formatDuration(msg.survivalMs)}</div><div class="l">Sống sót</div></div>
        </div>
        <div class="spacer"></div>
        <div class="menu-list">
          ${msg.teamAlive
            ? '<button class="btn primary" data-a="next">👁 Xem đồng đội</button>'
            : `${killerAlive ? '<button class="btn primary" data-a="killer">👁 Xem người hạ bạn</button>' : ''}
          <button class="btn" data-a="next">👁 Xem người chơi khác</button>`}
          <button class="btn danger" data-a="leave">🏠 Về sảnh</button>
        </div>
      </div></div>`;
    this.el.overlay.querySelectorAll<HTMLElement>('[data-a]').forEach((b) =>
      b.addEventListener('click', () => {
        const a = b.dataset.a!;
        if (a === 'leave') return this.cb.leave();
        this.cb.spectate(a === 'killer' ? 'killer' : 'next');
        this.overlay = 'none';
        this.el.overlay.innerHTML = '';
      }),
    );
  }

  get isDead(): boolean {
    return this.dead;
  }

  showEnd(msg: MatchEndMsg, onLobby: () => void) {
    this.overlay = 'end';
    const win = msg.placement === 1;
    const teamGame = msg.teamSize > 1;
    let rows: string;
    if (teamGame) {
      // one row per team, in rank order; ours is highlighted
      const teams = new Map<number, LeaderboardEntry[]>();
      for (const r of msg.leaderboard) teams.set(r.team ?? -1, [...(teams.get(r.team ?? -1) ?? []), r]);
      rows = [...teams.values()]
        .map((t) => `<tr${t[0].placement === msg.placement ? ' class="mine"' : ''}><td>#${t[0].placement}</td>
          <td>${t.map((r) => `${esc(r.avatar)} ${nameHtml(r.name, r.admin)}`).join('<br/>')}</td><td>${t.reduce((n, r) => n + r.kills, 0)}</td></tr>`)
        .join('');
    } else {
      rows = msg.leaderboard
        .map((r) => `<tr><td>#${r.placement}</td><td>${esc(r.avatar)} ${nameHtml(r.name, r.admin)}</td><td>${r.kills}</td></tr>`)
        .join('');
    }
    const teamName = teamGame && isTeamSize(msg.teamSize) ? ` · ${TEAM_SIZE_NAMES[msg.teamSize]}` : '';
    this.el.overlay.innerHTML = `
      <div class="overlay"><div class="card narrow center" style="max-width:520px">
        <div class="logo" style="font-size:${win ? (teamGame ? 38 : 44) : 36}px">${win ? (teamGame ? '🏆 ĐỘI BẠN CHIẾN THẮNG!' : '🏆 CHIẾN THẮNG!') : `HẠNG #${msg.placement}`}</div>
        <p class="muted">${esc(MODE_NAMES[msg.mode])}${teamName} · ${teamGame ? `${msg.teamCount} đội · ` : ''}${msg.playerCount} người · ${formatDuration(msg.durationMs)}</p>
        <p>${teamGame ? 'Đội chiến thắng' : 'Người chiến thắng'}: <b>${esc(msg.winnerName)}</b></p>
        <div class="grid cols-4">
          <div class="stat"><div class="v">${msg.kills}</div><div class="l">Hạ gục</div></div>
          <div class="stat"><div class="v">${msg.damage}</div><div class="l">Sát thương</div></div>
          <div class="stat"><div class="v">${formatDuration(msg.survivalMs)}</div><div class="l">Sống sót</div></div>
          <div class="stat"><div class="v">+${msg.xpGained}</div><div class="l">Kinh nghiệm</div></div>
        </div>
        <div class="spacer"></div>
        <div class="table-wrap" style="max-height:240px;overflow-y:auto"><table class="list"><thead><tr><th>Hạng</th><th>${teamGame ? 'Đội' : 'Người chơi'}</th><th>Hạ gục</th></tr></thead><tbody>${rows}</tbody></table></div>
        <div class="spacer"></div>
        <button class="btn primary big block" data-a="lobby">Về sảnh</button>
      </div></div>`;
    this.el.overlay.querySelector('[data-a="lobby"]')!.addEventListener('click', onLobby);
    this.el.spec.classList.add('hidden');
  }

  get death(): DeathMsg | null {
    return this.deathInfo;
  }

  destroy() {
    clearTimeout(this.centerTimer);
    window.removeEventListener('pointerup', this.onRelease);
    window.removeEventListener('pointercancel', this.onRelease);
    this.root.innerHTML = '';
    this.root.classList.add('hidden');
  }
}
