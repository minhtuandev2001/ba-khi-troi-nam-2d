import { settings } from '../settings';
import { TOUCH_SCALE_MAX, TOUCH_SCALE_MIN, type TouchButtonId, type TouchLayout } from '../shared';
import { canFullscreen, enterFullscreen, isFullscreen, isPhone, leaveFullscreen, lockLandscape } from '../ui/fullscreen';
import { layoutProfile, loadLayout, saveLayout } from '../ui/touchLayout';
import { iconSvg, scopeGlyph, type IconId } from './icons';

interface Stick {
  zone: HTMLElement;
  base: HTMLElement;
  knob: HTMLElement;
  pointerId: number | null;
  ox: number;
  oy: number;
  x: number;
  y: number;
}

export type TouchButton = TouchButtonId;

export interface TouchOptions {
  training?: boolean;
  /** Opened from the lobby: only the editor, no match behind it; `onDone` runs once it closes. */
  preview?: { onDone: () => void };
}

/**
 * play: everything active.
 * move: the inventory drawer is open; only the movement stick and the inventory toggle remain.
 * view: dead or spectating; only pause and map remain.
 * off:  a menu or result screen is open; the whole layer is hidden so it never steals taps.
 * edit: the player is moving and resizing the buttons; nothing reaches the game.
 */
export type TouchMode = 'play' | 'move' | 'view' | 'off' | 'edit';

const MODE_BUTTONS: Record<TouchMode, ReadonlySet<TouchButton> | null> = {
  play: null,
  move: new Set(['inventory']),
  view: new Set(['pause', 'map']),
  off: new Set(),
  edit: new Set(),
};

const BUTTON_NAMES: Record<TouchButton, string> = {
  heal: 'Hồi máu',
  reload: 'Nạp đạn',
  interact: 'Nhặt',
  smoke: 'Bom khói',
  grenade: 'Lựu đạn',
  pause: 'Tạm dừng',
  scope: 'Chim trinh sát',
  map: 'Bản đồ',
  inventory: 'Túi đồ',
};

interface Editing {
  draft: TouchLayout;
  bar: HTMLElement;
  selected: TouchButton | null;
  drag: { id: TouchButton; pointerId: number; dx: number; dy: number } | null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** On-screen joysticks: left moves, right aims and fires (release throws grenades). */
export class TouchControls {
  move = { x: 0, y: 0 };
  aim = { x: 0, y: 0, active: false };
  private releasePulse = false;
  private lastAimMagnitude = 0;
  private readonly left: Stick;
  private readonly right: Stick;
  private readonly radius: number;
  private readonly buttons = new Map<TouchButton, HTMLElement>();
  private readonly rotateHint: HTMLElement;
  private modeValue: TouchMode = 'play';
  private scopeLevel = 0;
  private readonly size: number;
  private profile = layoutProfile();
  private layout: TouchLayout = loadLayout(this.profile);
  private editing: Editing | null = null;
  /** Backup for players who did not tap their way in (room or party members): the first finished touch. */
  private readonly onFirstTouchEnd = () => void this.goFullscreen();
  private readonly onResize = () => this.syncProfile();

  private readonly preview: TouchOptions['preview'];

  constructor(private readonly root: HTMLElement, onButton: (b: TouchButton) => void, opts: TouchOptions = {}) {
    this.preview = opts.preview;
    this.radius = 56 * settings.touchSize;
    root.innerHTML = '';
    root.classList.remove('hidden');
    root.classList.toggle('preview', !!this.preview);
    root.dataset.mode = this.modeValue;
    document.body.classList.add('touch-ui');
    this.left = this.createStick('left');
    this.right = this.createStick('right');

    // default positions live in style.css (one layout for phones held sideways, one for tablets and upright screens);
    // buttons the player moved get inline positions on top of that
    const size = Math.round(50 * settings.touchSize);
    this.size = size;
    document.body.style.setProperty('--tb', `${size}px`);
    document.body.style.setProperty('--tb-big', `${Math.round(size * 1.3)}px`);
    const ic = (id: IconId) => iconSvg(id, Math.round(size * 0.62));
    const defs: [TouchButton, string][] = [
      ['heal', ic('medkit')],
      ['reload', '<small>R</small>'],
      ['interact', '<small>NHẶT</small>'],
      ['smoke', ic('smoke')],
      ['grenade', ic('grenade')],
      ['pause', '⏸'],
      ['scope', `${scopeGlyph(Math.round(size * 0.5))}<b class="tbadge">x1</b>`],
      ['map', '🗺️'],
      ['inventory', ic('bag2')],
    ];
    for (const [id, label] of defs) {
      const btn = document.createElement('div');
      btn.className = `tbtn t-${id}`;
      for (const mode of ['move', 'view'] as const) if (MODE_BUTTONS[mode]!.has(id)) btn.classList.add(`in-${mode}`);
      btn.innerHTML = label;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.editing) this.beginDrag(id, btn, e);
        else if (this.allows(id)) onButton(id);
      });
      btn.addEventListener('pointermove', (e) => this.moveDrag(id, btn, e));
      const endDrag = (e: PointerEvent) => {
        if (this.editing?.drag?.pointerId === e.pointerId) this.editing.drag = null;
      };
      btn.addEventListener('pointerup', endDrag);
      btn.addEventListener('pointercancel', endDrag);
      root.appendChild(btn);
      this.buttons.set(id, btn);
    }
    root.addEventListener('pointerdown', (e) => {
      if (this.editing && e.target === root) this.select(null);
    });
    this.applyLayout();
    window.addEventListener('resize', this.onResize);

    this.rotateHint = document.createElement('div');
    this.rotateHint.className = 'rotate-hint';
    document.body.appendChild(this.rotateHint);
    if (this.preview) {
      this.rotateHint.innerHTML = `
        <div class="rotate-phone" aria-hidden="true"></div>
        <b>Xoay ngang điện thoại để chỉnh nút</b>
        <p>Nút được xếp cho lúc cầm ngang khi chơi. Tắt khoá xoay màn hình nếu đang bật.</p>
        <button type="button" class="btn">Để sau</button>`;
      this.rotateHint.querySelector('button')!.addEventListener('click', () => this.finishEdit(false));
      this.startEdit();
      return;
    }
    this.rotateHint.innerHTML = `
      <div class="rotate-phone" aria-hidden="true"></div>
      <b>Xoay ngang điện thoại để chơi</b>
      <p>${opts.training ? 'Buổi tập' : 'Trận đấu'} vẫn đang diễn ra. Xoay ngang là chơi tiếp ngay.</p>
      ${canFullscreen() ? '<button type="button" class="btn primary">Toàn màn hình và xoay ngang</button>' : '<p class="muted">Tắt khoá xoay màn hình nếu đang bật.</p>'}`;
    this.rotateHint.querySelector('button')?.addEventListener('click', () => void this.goFullscreen());
    // the lobby usually turned fullscreen on already (on the button that led here); then only the lock is left
    if (isFullscreen()) void lockLandscape();
    else if (isPhone() && canFullscreen()) root.addEventListener('pointerup', this.onFirstTouchEnd, { capture: true, once: true });
  }

  private async goFullscreen() {
    this.root.removeEventListener('pointerup', this.onFirstTouchEnd, { capture: true });
    await enterFullscreen();
    await lockLandscape();
  }

  private createStick(side: 'left' | 'right'): Stick {
    const zone = document.createElement('div');
    zone.className = `joy-zone ${side}`;
    const base = document.createElement('div');
    base.className = 'joy-base hidden';
    const knob = document.createElement('div');
    knob.className = 'joy-knob hidden';
    const d = this.radius * 2;
    base.style.width = base.style.height = `${d}px`;
    knob.style.width = knob.style.height = `${d * 0.45}px`;
    zone.append(base, knob);
    this.root.appendChild(zone);
    const stick: Stick = { zone, base, knob, pointerId: null, ox: 0, oy: 0, x: 0, y: 0 };

    zone.addEventListener('pointerdown', (e) => {
      if (stick.pointerId !== null || !this.stickEnabled(side)) return;
      e.preventDefault();
      zone.setPointerCapture(e.pointerId);
      const rect = zone.getBoundingClientRect();
      stick.pointerId = e.pointerId;
      // the whole ring must fit inside its own half, so a touch near the centre line can't spill across
      const clamp = (v: number, max: number) => Math.min(Math.max(v, this.radius), Math.max(this.radius, max - this.radius));
      stick.ox = clamp(e.clientX - rect.left, rect.width);
      stick.oy = clamp(e.clientY - rect.top, rect.height);
      base.classList.remove('hidden');
      knob.classList.remove('hidden');
      if (side === 'right') this.aim.active = true;
      this.track(stick, side, e);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== stick.pointerId || !this.stickEnabled(side)) return;
      this.track(stick, side, e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== stick.pointerId) return;
      stick.pointerId = null;
      if (side === 'right' && this.lastAimMagnitude > 0.2 && e.type === 'pointerup' && this.mode === 'play') this.releasePulse = true;
      stick.x = 0;
      stick.y = 0;
      base.classList.add('hidden');
      knob.classList.add('hidden');
      this.sync(side, stick);
      if (side === 'right') this.aim.active = false;
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('lostpointercapture', end);
    return stick;
  }

  get mode(): TouchMode {
    return this.editing ? 'edit' : this.modeValue;
  }

  setMode(mode: TouchMode) {
    if (mode === this.modeValue) return;
    this.modeValue = mode;
    if (this.editing) {
      // a menu or result screen took over (back gesture, death, match end): keep what was arranged so far
      if (mode === 'off') this.finishEdit(true);
      return;
    }
    this.root.dataset.mode = mode;
    // keep a held movement stick when only aiming is suspended, so the player can keep walking
    if (mode === 'move') this.reset([this.right]);
    else if (mode !== 'play') this.reset([this.left, this.right]);
  }

  private stickEnabled(side: 'left' | 'right'): boolean {
    return this.mode === 'play' || (this.mode === 'move' && side === 'left');
  }

  private allows(b: TouchButton): boolean {
    const only = MODE_BUTTONS[this.mode];
    return only === null || only.has(b);
  }

  /** Drops held sticks so nothing keeps moving, firing or throwing once play is interrupted. */
  private reset(sticks: Stick[] = [this.left, this.right]) {
    for (const s of sticks) {
      if (s.pointerId !== null) {
        const id = s.pointerId;
        s.pointerId = null;
        if (s.zone.hasPointerCapture?.(id)) s.zone.releasePointerCapture(id);
      }
      s.x = 0;
      s.y = 0;
      s.base.classList.add('hidden');
      s.knob.classList.add('hidden');
    }
    if (sticks.includes(this.left)) {
      this.move.x = 0;
      this.move.y = 0;
    }
    if (!sticks.includes(this.right)) return;
    this.aim.x = 0;
    this.aim.y = 0;
    this.aim.active = false;
    this.releasePulse = false;
    this.lastAimMagnitude = 0;
  }

  private track(stick: Stick, side: 'left' | 'right', e: PointerEvent) {
    const rect = stick.zone.getBoundingClientRect();
    let dx = e.clientX - rect.left - stick.ox;
    let dy = e.clientY - rect.top - stick.oy;
    const len = Math.hypot(dx, dy);
    if (len > this.radius) {
      dx = (dx / len) * this.radius;
      dy = (dy / len) * this.radius;
    }
    stick.x = dx / this.radius;
    stick.y = dy / this.radius;
    this.place(stick, stick.ox, stick.oy, dx, dy);
    this.sync(side, stick);
  }

  private place(s: Stick, ox: number, oy: number, dx: number, dy: number) {
    s.base.style.left = `${ox}px`;
    s.base.style.top = `${oy}px`;
    s.knob.style.left = `${ox + dx}px`;
    s.knob.style.top = `${oy + dy}px`;
  }

  private sync(side: 'left' | 'right', s: Stick) {
    if (side === 'left') {
      this.move.x = s.x;
      this.move.y = s.y;
    } else {
      this.aim.x = s.x;
      this.aim.y = s.y;
      const m = Math.hypot(s.x, s.y);
      if (s.pointerId !== null) this.lastAimMagnitude = m;
    }
  }

  get aimMagnitude(): number {
    return Math.hypot(this.aim.x, this.aim.y);
  }

  get lastThrowMagnitude(): number {
    return this.lastAimMagnitude;
  }

  get fireHeld(): boolean {
    return this.mode === 'play' && this.aim.active && this.aimMagnitude > 0.35;
  }

  consumeRelease(): boolean {
    const v = this.releasePulse && this.mode === 'play';
    this.releasePulse = false;
    return v;
  }

  setInteractLabel(label: string | null) {
    const btn = this.buttons.get('interact');
    if (!btn) return;
    btn.classList.toggle('on', !!label);
    btn.style.opacity = label ? '1' : '0.45';
  }

  setScopeLabel(level: number) {
    if (level === this.scopeLevel) return;
    const first = this.scopeLevel === 0;
    this.scopeLevel = level;
    const badge = this.buttons.get('scope')?.querySelector<HTMLElement>('.tbadge');
    if (!badge) return;
    badge.textContent = `x${level}`;
    if (!first) badge.animate([{ transform: 'scale(1.6)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'cubic-bezier(0.3, 1.6, 0.6, 1)' });
  }

  // ---------------------------------------------------------------- button layout

  get isEditing(): boolean {
    return this.editing !== null;
  }

  /** Lets the player drag buttons around and resize them; the match keeps running underneath. */
  startEdit() {
    if (this.editing) return;
    this.reset();
    const bar = document.createElement('div');
    bar.className = 'tedit-bar';
    bar.innerHTML = `
      <div class="tedit-head" title="Kéo để dời bảng này"><b>Chỉnh nút</b><span class="tedit-sel"></span></div>
      <label class="tedit-size">Cỡ <input type="range" min="${TOUCH_SCALE_MIN * 100}" max="${TOUCH_SCALE_MAX * 100}" step="5" value="100" /><b>100%</b></label>
      <div class="tedit-actions">
        <button type="button" class="btn small" data-e="reset">Mặc định</button>
        <button type="button" class="btn small" data-e="cancel">Huỷ</button>
        <button type="button" class="btn small primary" data-e="save">Lưu</button>
      </div>`;
    bar.addEventListener('pointerdown', (e) => e.stopPropagation());
    bar.querySelector('input')!.addEventListener('input', (e) => this.resizeSelected(Number((e.target as HTMLInputElement).value) / 100));
    bar.querySelectorAll<HTMLElement>('[data-e]').forEach((b) =>
      b.addEventListener('click', () => {
        const action = b.dataset.e;
        if (action === 'save') this.finishEdit(true);
        else if (action === 'cancel') this.finishEdit(false);
        else this.resetDraft();
      }),
    );
    this.makeMovable(bar, bar.querySelector('.tedit-head')!);
    this.root.appendChild(bar);
    this.editing = { draft: JSON.parse(JSON.stringify(this.layout)) as TouchLayout, bar, selected: null, drag: null };
    this.root.dataset.mode = 'edit';
    this.select(null);
    this.applyLayout();
  }

  private finishEdit(save: boolean) {
    const ed = this.editing;
    if (!ed) return;
    if (save) {
      this.layout = ed.draft;
      saveLayout(this.profile, this.layout);
    }
    ed.bar.remove();
    this.editing = null;
    if (this.preview) {
      this.preview.onDone();
      return;
    }
    for (const btn of this.buttons.values()) btn.classList.remove('sel');
    this.root.dataset.mode = this.modeValue;
    this.applyLayout();
  }

  private resetDraft() {
    if (!this.editing) return;
    this.editing.draft = {};
    this.applyLayout();
    this.select(this.editing.selected);
  }

  private select(id: TouchButton | null) {
    const ed = this.editing;
    if (!ed) return;
    ed.selected = id;
    for (const [bid, btn] of this.buttons) btn.classList.toggle('sel', bid === id);
    const scale = id ? ed.draft[id]?.s ?? 1 : 1;
    const input = ed.bar.querySelector('input')!;
    input.disabled = !id;
    input.value = String(Math.round(scale * 100));
    ed.bar.querySelector('.tedit-size b')!.textContent = `${Math.round(scale * 100)}%`;
    ed.bar.querySelector('.tedit-sel')!.textContent = id ? BUTTON_NAMES[id] : 'Kéo nút để dời chỗ, chạm một nút để đổi cỡ';
  }

  private resizeSelected(scale: number) {
    const ed = this.editing;
    const id = ed?.selected;
    if (!ed || !id) return;
    const place = { ...ed.draft[id] };
    if (Math.abs(scale - 1) < 0.001) delete place.s;
    else place.s = scale;
    if (Object.keys(place).length) ed.draft[id] = place;
    else delete ed.draft[id];
    ed.bar.querySelector('.tedit-size b')!.textContent = `${Math.round(scale * 100)}%`;
    this.applyLayout();
  }

  private beginDrag(id: TouchButton, btn: HTMLElement, e: PointerEvent) {
    const ed = this.editing!;
    this.select(id);
    const r = btn.getBoundingClientRect();
    ed.drag = { id, pointerId: e.pointerId, dx: r.left + r.width / 2 - e.clientX, dy: r.top + r.height / 2 - e.clientY };
    btn.setPointerCapture(e.pointerId);
  }

  private moveDrag(id: TouchButton, btn: HTMLElement, e: PointerEvent) {
    const ed = this.editing;
    if (!ed?.drag || ed.drag.id !== id || ed.drag.pointerId !== e.pointerId) return;
    const scale = ed.draft[id]?.s ?? 1;
    const at = this.placeAt(id, btn, e.clientX + ed.drag.dx, e.clientY + ed.drag.dy, scale);
    ed.draft[id] = { ...ed.draft[id], x: at.x / window.innerWidth, y: at.y / window.innerHeight };
  }

  /** Drag by `handle` to move `el` anywhere on screen. */
  private makeMovable(el: HTMLElement, handle: HTMLElement) {
    let grab: { id: number; ox: number; oy: number } | null = null;
    handle.addEventListener('pointerdown', (e) => {
      const r = el.getBoundingClientRect();
      grab = { id: e.pointerId, ox: e.clientX - r.left, oy: e.clientY - r.top };
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (grab?.id !== e.pointerId) return;
      el.style.transform = 'none';
      el.style.left = `${clamp(e.clientX - grab.ox, 0, window.innerWidth - el.offsetWidth)}px`;
      el.style.top = `${clamp(e.clientY - grab.oy, 0, window.innerHeight - el.offsetHeight)}px`;
    });
    const drop = () => (grab = null);
    handle.addEventListener('pointerup', drop);
    handle.addEventListener('pointercancel', drop);
  }

  private baseSize(id: TouchButton): number {
    return id === 'interact' ? Math.round(this.size * 1.3) : this.size;
  }

  /** Puts the button's centre at (cx, cy), kept fully on screen; returns where it ended up. */
  private placeAt(id: TouchButton, btn: HTMLElement, cx: number, cy: number, scale: number) {
    const base = this.baseSize(id);
    const half = (base * scale) / 2;
    const x = clamp(cx, half, window.innerWidth - half);
    const y = clamp(cy, half, window.innerHeight - half);
    btn.style.left = `${x - base / 2}px`;
    btn.style.top = `${y - base / 2}px`;
    btn.style.right = btn.style.bottom = 'auto';
    return { x, y };
  }

  private applyLayout() {
    const layout = this.editing?.draft ?? this.layout;
    for (const [id, btn] of this.buttons) {
      const place = layout[id];
      for (const prop of ['left', 'top', 'right', 'bottom']) btn.style.removeProperty(prop);
      if (place?.s) btn.style.setProperty('--s', String(place.s));
      else btn.style.removeProperty('--s');
      if (place?.x !== undefined && place.y !== undefined) {
        this.placeAt(id, btn, place.x * window.innerWidth, place.y * window.innerHeight, place.s ?? 1);
      }
    }
  }

  /** Turning the device can switch to another layout; arrangements in progress are kept for the old one. */
  private syncProfile() {
    const profile = layoutProfile();
    if (profile !== this.profile) {
      if (this.editing) {
        saveLayout(this.profile, this.editing.draft);
        this.editing.draft = loadLayout(profile);
        this.editing.bar.removeAttribute('style');
      }
      this.profile = profile;
      this.layout = loadLayout(profile);
      if (this.editing) this.select(this.editing.selected);
    }
    this.applyLayout();
  }

  destroy() {
    this.reset();
    if (this.editing) this.finishEdit(true);
    window.removeEventListener('resize', this.onResize);
    this.root.removeEventListener('pointerup', this.onFirstTouchEnd, { capture: true });
    if (!this.preview) leaveFullscreen();
    this.rotateHint.remove();
    delete this.root.dataset.mode;
    document.body.style.removeProperty('--tb');
    document.body.style.removeProperty('--tb-big');
    document.body.classList.remove('touch-ui');
    this.root.innerHTML = '';
    this.root.classList.remove('preview');
    this.root.classList.add('hidden');
  }
}
