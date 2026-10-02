import {
  AMMO_NAMES,
  AMMO_TYPES,
  BAG_CAPACITY,
  MAX_HP,
  MODE_NAMES,
  SCOPE_VIEW_MULTIPLIER,
  WEAPONS,
  weaponName,
  type AirdropNet,
  type DeathMsg,
  type GameMap,
  type MatchEndMsg,
  type RosterEntry,
  type ScopeLevel,
  type SelfNet,
  type SlotName,
  type ZoneNet,
} from '../shared';
import { esc, formatDuration, html } from '../ui/dom';
import { bindSettings, guidePanel, keysPanel, settingsPanel } from '../ui/panels';
import { iconHtml, iconSvg, rarityCss, scopeGlyph, type IconId } from './icons';
import { MapRenderer } from './Minimap';

export interface HudCallbacks {
  equip(slot: SlotName): void;
  drop(what: string): void;
  setScope(level: number): void;
  spectate(target: 'killer' | 'next'): void;
  leave(): void;
}

type Overlay = 'none' | 'inventory' | 'map' | 'pause' | 'death' | 'end';

const SLOT_KEYS: Record<SlotName, string> = { p1: '1', p2: '2', pistol: 'E', melee: 'V', grenade: '3', smoke: '4' };
const GUN_SLOTS = ['p1', 'p2', 'pistol'] as const;

/** Snapshots arrive 15 times a second; skipping identical writes avoids needless style and layout work. */
function setText(el: HTMLElement, text: string) {
  if (el.textContent !== text) el.textContent = text;
}

function scopeCell(level: number, active: boolean): string {
  const id = `scope${level}` as IconId;
  const scoped = level > 1;
  const bonus = Math.round((SCOPE_VIEW_MULTIPLIER[level as ScopeLevel] - 1) * 100);
  return `<div class="inv-cell scope-cell ${active ? 'active' : ''}" data-scope="${level}" style="--rarity:${scoped ? rarityCss(id) : '#b8c6d4'}">` +
    `<div class="inv-ic">${scoped ? iconSvg(id, 40) : scopeGlyph(26)}</div>` +
    `<div class="inv-text"><b>${scoped ? `Ống nhắm x${level}` : 'Mắt thường x1'}</b>` +
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
  private lastMinimap = 0;
  private centerTimer = 0;
  private deathInfo: DeathMsg | null = null;
  private dead = false;
  private scopeActive = 0;
  private scopeIndex = 0;
  private scopeOwned = '';
  private readonly scopeChips = new Map<number, HTMLElement>();
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
    map: GameMap,
    private readonly roster: RosterEntry[],
    private readonly you: number,
    private readonly cb: HudCallbacks,
  ) {
    root.innerHTML = `
      <div class="hud-top-left"><div class="hud-pill" id="h-alive">👤 0</div><div class="hud-pill" id="h-kills">💀 0</div></div>
      <div class="hud-zone" id="h-zone">Đang tải…</div>
      <button class="btn small pause-btn" id="h-pause" title="Tạm dừng (Esc)">⏸</button>
      <div class="hud-top-right">
        <canvas class="minimap interactive" id="h-minimap" width="170" height="170" title="Bản đồ (M)"></canvas>
        <div class="hud-scope interactive" id="h-scope" title="Ống nhắm (Z)"><span class="glyph">${scopeGlyph(18)}</span><div class="scope-track" id="h-scopetrack"><div class="scope-ind"></div></div><span class="kbd">Z</span></div>
        <div class="killfeed" id="h-feed"></div>
      </div>
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

  private name(pid: number): string {
    return this.roster.find((r) => r.pid === pid)?.name ?? '???';
  }

  update(me: SelfNet, alive: number, zone: ZoneNet, airdrops: AirdropNet[], spectating: boolean, x: number, y: number) {
    this.me = me;
    this.zone = zone;
    this.airdrops = airdrops;
    setText(this.el.alive, `👤 ${alive}`);
    setText(this.el.kills, `💀 ${me.kills}`);

    const [, , , , , , phase, stage, left, dps] = zone;
    const label = stage === 'wait' ? `Bo ${phase} thu nhỏ sau` : stage === 'shrink' ? `Bo ${phase} đang thu nhỏ` : 'Bo cuối';
    const outside = Math.hypot(x - zone[0], y - zone[1]) > zone[2];
    const zoneHtml = `${label} <b>${stage === 'done' ? '' : formatDuration(left)}</b>${outside ? ` <span class="warn">· Ngoài bo −${dps}/s</span>` : ''}`;
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
    if (me.reloadLeft > 0 || me.healLeft > 0) {
      const healing = me.healLeft > 0;
      const left = healing ? me.healLeft : me.reloadLeft;
      const total = healing ? 3000 : (() => {
        const s = me.active === 'p1' || me.active === 'p2' || me.active === 'pistol' ? me[me.active] : null;
        return s ? WEAPONS[s.w].reloadMs : 1000;
      })();
      prog.classList.remove('hidden');
      setText(prog.querySelector<HTMLElement>('.progress-label')!, `${healing ? 'Đang dùng túi cứu thương' : 'Đang thay đạn'} ${(left / 1000).toFixed(1)}s`);
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
      this.mapRenderer.draw(this.minimap, { x, y, a: me.a, zone, airdrops }, { zoom: 3.2 });
      if (this.bigMap) this.mapRenderer.draw(this.bigMap, { x, y, a: me.a, zone, airdrops }, { grid: true });
    }

    this.el.spec.classList.toggle('hidden', !spectating || this.overlay === 'death' || this.overlay === 'end');
    if (spectating) {
      const sig = `spec-${me.pid}`;
      if (this.el.spec.dataset.sig !== sig) {
        this.el.spec.dataset.sig = sig;
        this.el.spec.innerHTML = `<span>Đang xem: <b>${esc(this.name(me.pid))}</b></span>
          <button class="btn small" data-a="next">Người tiếp theo</button>
          <button class="btn small danger" data-a="leave">Về sảnh</button>`;
        this.el.spec.querySelector('[data-a="next"]')!.addEventListener('click', () => this.cb.spectate('next'));
        this.el.spec.querySelector('[data-a="leave"]')!.addEventListener('click', () => this.cb.leave());
      }
    }
    this.el.bottom.style.opacity = spectating ? '0.75' : '1';
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
      if (!s) return `<div class="slot empty" data-slot="${slot}"><span class="k">${SLOT_KEYS[slot]}</span><div class="si"></div><div class="n">${slot === 'pistol' ? 'Súng lục' : 'Trống'}</div><div class="a">&nbsp;</div></div>`;
      const def = WEAPONS[s.w];
      return `<div class="slot ${me.active === slot ? 'active' : ''}" data-slot="${slot}"><span class="k">${SLOT_KEYS[slot]}</span><div class="si">${iconSvg(s.w, 30)}</div><div class="n">${esc(def.name)}</div><div class="a"></div></div>`;
    };
    const simple = (slot: SlotName, icon: IconId, name: string, count: string, empty: boolean) =>
      `<div class="slot ${me.active === slot ? 'active' : ''} ${empty ? 'empty' : ''}" data-slot="${slot}"><span class="k">${SLOT_KEYS[slot]}</span><div class="si">${iconSvg(icon, 30)}</div><div class="n">${name}</div><div class="a">${count}</div></div>`;
    this.el.slots.innerHTML =
      gun('p1') + gun('p2') + gun('pistol') +
      simple('melee', me.melee, WEAPONS[me.melee].name, '&nbsp;', false) +
      simple('grenade', 'grenade', 'Lựu đạn', `×${me.gren}`, me.gren === 0) +
      simple('smoke', 'smoke', 'Khói', `×${me.smoke}`, me.smoke === 0);
  }

  private renderInventorySummary(me: SelfNet) {
    const sig = JSON.stringify([me.ammo, me.med, me.armor, me.armorDur, me.bag]);
    if (sig === this.invSig) return;
    this.invSig = sig;
    const cap = BAG_CAPACITY[me.bag];
    const row = (icon: IconId, text: string) => `<div>${iconHtml(icon, 20)}<span>${text}</span></div>`;
    this.el.inv.innerHTML =
      row(me.armor ? (`armor${me.armor}` as IconId) : 'armor1', `Giáp: ${me.armor ? `cấp ${me.armor} (${me.armorDur})` : 'không có'}`) +
      row(me.bag ? (`bag${me.bag}` as IconId) : 'bag1', `Túi: ${me.bag ? `cấp ${me.bag}` : 'không có'}`) +
      row('medkit', `Cứu thương: ${me.med}/${cap.medkit} <span class="kbd">Q</span>`) +
      AMMO_TYPES.map((t) => row(`ammo_${t}`, `${AMMO_NAMES[t]}: ${me.ammo[t]}/${cap.ammo[t]}`)).join('');
  }

  feed(htmlText: string, mine = false) {
    const row = html(`<div class="${mine ? 'me' : ''}">${htmlText}</div>`);
    this.el.feed.prepend(row);
    while (this.el.feed.children.length > 6) this.el.feed.lastElementChild?.remove();
    setTimeout(() => row.remove(), 7000);
  }

  killFeed(killer: number, victim: number, weapon: string) {
    const v = `<b>${esc(this.name(victim))}</b>`;
    const mine = killer === this.you || victim === this.you;
    if (weapon === 'zone') this.feed(`${v} đã chết ngoài vòng bo`, mine);
    else if (weapon === 'leave') this.feed(`${v} đã rời trận`, mine);
    else if (killer < 0 || killer === victim) this.feed(`${v} đã tự hạ gục mình`, mine);
    else this.feed(`<b>${esc(this.name(killer))}</b> <span class="weapon">[${esc(weaponName(weapon))}]</span> ${v}`, mine);
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
    const size = Math.floor(Math.min(window.innerWidth * 0.94, window.innerHeight * 0.86));
    const wrap = html(`<div class="bigmap"><canvas width="${size}" height="${size}"></canvas></div>`);
    wrap.addEventListener('click', () => this.show('none'));
    this.el.overlay.appendChild(wrap);
    this.bigMap = wrap.querySelector('canvas');
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
          ${gun('p1', 'Súng chính 1')}${gun('p2', 'Súng chính 2')}${gun('pistol', 'Súng lục')}
          ${cell(me.melee, true, 'Cận chiến', esc(WEAPONS[me.melee].name), me.melee !== 'fists' ? 'melee' : undefined)}
          ${cell(`armor${me.armor || 1}` as IconId, me.armor > 0, 'Giáp', me.armor ? `Cấp ${me.armor} · độ bền ${me.armorDur}` : 'Không có', me.armor ? 'armor' : undefined)}
          ${cell(`bag${me.bag || 1}` as IconId, me.bag > 0, 'Túi đồ', me.bag ? `Cấp ${me.bag}` : 'Không có', me.bag ? 'bag' : undefined)}
          ${cell('medkit', me.med > 0, 'Túi cứu thương', `${me.med} / ${cap.medkit}`, me.med ? 'medkit' : undefined)}
          ${cell('grenade', me.gren > 0, 'Lựu đạn', `${me.gren} / ${cap.grenade}`, me.gren ? 'grenade' : undefined)}
          ${cell('smoke', me.smoke > 0, 'Bom khói', `${me.smoke} / ${cap.smoke}`, me.smoke ? 'smoke' : undefined)}
          ${AMMO_TYPES.map((t) => cell(`ammo_${t}`, me.ammo[t] > 0, AMMO_NAMES[t], `${me.ammo[t]} / ${cap.ammo[t]}`, me.ammo[t] ? `ammo_${t}` : undefined)).join('')}
        </div>
        <h3>Ống nhắm <span class="muted">· bấm để đổi</span></h3>
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
    let body = '';
    if (view === 'menu') {
      body = `<h2 class="center">Tạm dừng</h2>
        <p class="muted center">Trận đấu vẫn tiếp tục khi bạn mở menu này.</p>
        <div class="menu-list">
          <button class="btn primary" data-v="close">▶ Tiếp tục</button>
          <button class="btn" data-v="settings">⚙️ Cài đặt</button>
          <button class="btn" data-v="keys">⌨️ Phím tắt</button>
          <button class="btn" data-v="guide">📖 Hướng dẫn</button>
          <button class="btn danger" data-v="confirm">🚪 Thoát trận</button>
        </div>`;
    } else if (view === 'settings') body = `<div class="row between"><h2>Cài đặt</h2>${back}</div>${settingsPanel()}`;
    else if (view === 'keys') body = `<div class="row between"><h2>Phím tắt</h2>${back}</div>${keysPanel()}`;
    else if (view === 'guide') body = `<div class="row between"><h2>Hướng dẫn</h2>${back}</div>${guidePanel()}`;
    else {
      body = `<h2>Thoát trận?</h2>
        <p>${this.dead ? 'Bạn sẽ quay về sảnh.' : 'Nhân vật của bạn sẽ bị loại khỏi trận và tính là bị hạ gục.'}</p>
        <div class="row"><button class="btn danger" data-v="leave">Thoát</button>${back}</div>`;
    }
    box.innerHTML = `<div class="overlay"><div class="card inventory-panel">${body}</div></div>`;
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
    const total = this.roster.length;
    const how = msg.weapon === 'zone'
      ? 'Bạn đã chết ngoài vòng bo.'
      : msg.weapon === 'leave'
        ? 'Bạn đã rời trận.'
        : msg.killer >= 0 && msg.killer !== this.you
          ? `Bạn bị <b>${esc(this.name(msg.killer))}</b> hạ gục bằng <b>${esc(weaponName(msg.weapon))}</b>.`
          : 'Bạn đã tự hạ gục mình.';
    this.el.overlay.innerHTML = `
      <div class="overlay"><div class="card narrow center">
        <h2>☠️ Bạn đã bị loại</h2>
        <div class="logo" style="font-size:40px">#${msg.placement} <span class="muted" style="font-size:20px">/ ${total}</span></div>
        <p>${how}</p>
        <div class="grid cols-3">
          <div class="stat"><div class="v">${msg.kills}</div><div class="l">Hạ gục</div></div>
          <div class="stat"><div class="v">${msg.damage}</div><div class="l">Sát thương</div></div>
          <div class="stat"><div class="v">${formatDuration(msg.survivalMs)}</div><div class="l">Sống sót</div></div>
        </div>
        <div class="spacer"></div>
        <div class="menu-list">
          ${killerAlive ? '<button class="btn primary" data-a="killer">👁 Xem người hạ bạn</button>' : ''}
          <button class="btn" data-a="next">👁 Xem người chơi khác</button>
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
    const rows = msg.leaderboard
      .map((r) => `<tr><td>#${r.placement}</td><td>${esc(r.avatar)} ${esc(r.name)}</td><td>${r.kills}</td></tr>`)
      .join('');
    this.el.overlay.innerHTML = `
      <div class="overlay"><div class="card narrow center" style="max-width:520px">
        <div class="logo" style="font-size:${win ? 44 : 36}px">${win ? '🏆 CHIẾN THẮNG!' : `HẠNG #${msg.placement}`}</div>
        <p class="muted">${esc(MODE_NAMES[msg.mode])} · ${msg.playerCount} người · ${formatDuration(msg.durationMs)}</p>
        <p>Người chiến thắng: <b>${esc(msg.winnerName)}</b></p>
        <div class="grid cols-4">
          <div class="stat"><div class="v">${msg.kills}</div><div class="l">Hạ gục</div></div>
          <div class="stat"><div class="v">${msg.damage}</div><div class="l">Sát thương</div></div>
          <div class="stat"><div class="v">${formatDuration(msg.survivalMs)}</div><div class="l">Sống sót</div></div>
          <div class="stat"><div class="v">+${msg.xpGained}</div><div class="l">Kinh nghiệm</div></div>
        </div>
        <div class="spacer"></div>
        <div class="table-wrap" style="max-height:240px;overflow-y:auto"><table class="list"><thead><tr><th>Hạng</th><th>Người chơi</th><th>Hạ gục</th></tr></thead><tbody>${rows}</tbody></table></div>
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
