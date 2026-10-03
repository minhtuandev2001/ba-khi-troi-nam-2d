import { settings } from '../settings';
import { canFullscreen, enterFullscreen, isFullscreen, isPhone, leaveFullscreen, lockLandscape } from '../ui/fullscreen';
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

export type TouchButton = 'reload' | 'interact' | 'heal' | 'grenade' | 'smoke' | 'scope' | 'map' | 'inventory' | 'pause';

/**
 * play: everything active.
 * move: the inventory drawer is open; only the movement stick and the inventory toggle remain.
 * view: dead or spectating; only pause and map remain.
 * off:  a menu or result screen is open; the whole layer is hidden so it never steals taps.
 */
export type TouchMode = 'play' | 'move' | 'view' | 'off';

const MODE_BUTTONS: Record<TouchMode, ReadonlySet<TouchButton> | null> = {
  play: null,
  move: new Set(['inventory']),
  view: new Set(['pause', 'map']),
  off: new Set(),
};

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
  /** Backup for players who did not tap their way in (room or party members): the first finished touch. */
  private readonly onFirstTouchEnd = () => void this.goFullscreen();

  constructor(private readonly root: HTMLElement, onButton: (b: TouchButton) => void, training = false) {
    this.radius = 56 * settings.touchSize;
    root.innerHTML = '';
    root.classList.remove('hidden');
    root.dataset.mode = this.modeValue;
    document.body.classList.add('touch-ui');
    this.left = this.createStick('left');
    this.right = this.createStick('right');

    // positions live in style.css (one layout for phones held sideways, one for tablets and upright screens)
    const size = Math.round(50 * settings.touchSize);
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
        if (this.allows(id)) onButton(id);
      });
      root.appendChild(btn);
      this.buttons.set(id, btn);
    }

    this.rotateHint = document.createElement('div');
    this.rotateHint.className = 'rotate-hint';
    this.rotateHint.innerHTML = `
      <div class="rotate-phone" aria-hidden="true"></div>
      <b>Xoay ngang điện thoại để chơi</b>
      <p>${training ? 'Buổi tập' : 'Trận đấu'} vẫn đang diễn ra. Xoay ngang là chơi tiếp ngay.</p>
      ${canFullscreen() ? '<button type="button" class="btn primary">Toàn màn hình và xoay ngang</button>' : '<p class="muted">Tắt khoá xoay màn hình nếu đang bật.</p>'}`;
    this.rotateHint.querySelector('button')?.addEventListener('click', () => void this.goFullscreen());
    document.body.appendChild(this.rotateHint);
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
      if (side === 'right' && this.lastAimMagnitude > 0.2 && e.type === 'pointerup' && this.modeValue === 'play') this.releasePulse = true;
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
    return this.modeValue;
  }

  setMode(mode: TouchMode) {
    if (mode === this.modeValue) return;
    this.modeValue = mode;
    this.root.dataset.mode = mode;
    // keep a held movement stick when only aiming is suspended, so the player can keep walking
    if (mode === 'move') this.reset([this.right]);
    else if (mode !== 'play') this.reset([this.left, this.right]);
  }

  private stickEnabled(side: 'left' | 'right'): boolean {
    return this.modeValue === 'play' || (this.modeValue === 'move' && side === 'left');
  }

  private allows(b: TouchButton): boolean {
    const only = MODE_BUTTONS[this.modeValue];
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
    return this.modeValue === 'play' && this.aim.active && this.aimMagnitude > 0.35;
  }

  consumeRelease(): boolean {
    const v = this.releasePulse && this.modeValue === 'play';
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

  destroy() {
    this.reset();
    this.root.removeEventListener('pointerup', this.onFirstTouchEnd, { capture: true });
    leaveFullscreen();
    this.rotateHint.remove();
    delete this.root.dataset.mode;
    document.body.style.removeProperty('--tb');
    document.body.style.removeProperty('--tb-big');
    document.body.classList.remove('touch-ui');
    this.root.innerHTML = '';
    this.root.classList.add('hidden');
  }
}
