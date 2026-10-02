import Phaser from 'phaser';
import type { Socket } from 'socket.io-client';
import {
  AIRDROP_SIZE,
  CollisionWorld,
  INTERACT_RANGE,
  INTERPOLATION_DELAY_MS,
  ITEMS,
  PICKUP_RANGE,
  SCOPE_LEVELS,
  THROWABLE,
  TICK_MS,
  generateMap,
  playerSpeed,
  stepMovement,
  weaponName,
  type ActionMsg,
  type AirdropNet,
  type ArmorLevel,
  type BagLevel,
  type DeathMsg,
  type GameEvent,
  type GameMap,
  type InputMsg,
  type LootNet,
  type MatchEndMsg,
  type MatchStartMsg,
  type PlayerNet,
  type SelfNet,
  type SlotName,
  type SmokeNet,
  type SnapshotMsg,
  type ThrowableNet,
  type WeaponId,
  type ZoneNet,
} from '../shared';
import { settings, useTouchControls } from '../settings';
import { esc, toast } from '../ui/dom';
import { sfx, stopAmbient, unlockAudio } from './audio';
import { GameScene } from './GameScene';
import { Hud } from './Hud';
import { TouchControls, type TouchButton } from './Touch';

const TICK_S = TICK_MS / 1000;

interface BufferedSnap {
  t: number;
  players: Map<number, PlayerNet>;
}

export interface RenderPlayer {
  pid: number;
  x: number;
  y: number;
  a: number;
  weapon: WeaponId;
  armor: ArmorLevel;
  bag: BagLevel;
  flags: number;
}

const WEAPON_CYCLE: SlotName[] = ['p1', 'p2', 'pistol', 'melee'];

export class GameSession {
  readonly map: GameMap;
  readonly world: CollisionWorld;
  readonly you: number;
  readonly hud: Hud;
  private readonly touch: TouchControls | null;
  private readonly game: Phaser.Game;
  private scene: GameScene | null = null;

  me: SelfNet | null = null;
  spectating = false;
  zone: ZoneNet | null = null;
  smokes: SmokeNet[] = [];
  throwables: ThrowableNet[] = [];
  airdrops: AirdropNet[] = [];
  ping = 0;
  private alive = 0;
  private loot = new Map<number, LootNet>();
  private pendingLoot: { add: LootNet[]; del: number[] } = { add: [], del: [] };
  private pendingEvents: GameEvent[] = [];
  private buffer: BufferedSnap[] = [];
  private serverOffset: number | null = null;

  private seq = 0;
  private pending: InputMsg[] = [];
  private pred = { x: 0, y: 0 };
  private predOffset = { x: 0, y: 0 };
  private predReady = false;
  private accumulator = 0;
  private aimAngle = 0;

  private keys = new Set<string>();
  private mouse = { x: 0, y: 0, down: false };
  private ended = false;
  private lastPrompt = 0;
  private pingTimer: number;
  private readonly cleanups: (() => void)[] = [];

  constructor(
    private readonly start: MatchStartMsg,
    private readonly socket: Socket,
    private readonly onExit: () => void,
  ) {
    this.map = generateMap(start.seed);
    this.world = new CollisionWorld(this.map);
    start.doorsOpen.forEach((open, i) => (this.world.doorOpen[i] = open));
    start.chestsAlive.forEach((alive, i) => (this.world.chestAlive[i] = alive));
    this.you = start.you;

    this.hud = new Hud(document.getElementById('hud')!, this.map, start.roster, start.you, {
      equip: (slot) => this.action({ t: 'equip', slot }),
      drop: (what) => this.action({ t: 'drop', what: what as Extract<ActionMsg, { t: 'drop' }>['what'] }),
      setScope: (level) => this.action({ t: 'scope', level }),
      spectate: (target) => this.socket.emit('spectate', target),
      leave: () => this.leave(),
    });

    this.touch = useTouchControls() ? new TouchControls(document.getElementById('touch')!, (b) => this.onTouchButton(b)) : null;

    const dpr = settings.quality === 'high' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'game',
      backgroundColor: '#2c4a22',
      banner: false,
      audio: { noAudio: true },
      scale: {
        mode: Phaser.Scale.NONE,
        width: Math.round(window.innerWidth * dpr),
        height: Math.round(window.innerHeight * dpr),
        zoom: 1 / dpr,
      },
      render: { antialias: true, powerPreference: 'high-performance' },
      input: { touch: !this.touch, mouse: { preventDefaultWheel: true } },
      scene: [new GameScene(this)],
    });
    const onResize = () => this.game.scale.resize(Math.round(window.innerWidth * dpr), Math.round(window.innerHeight * dpr));
    this.listen(window, 'resize', onResize);

    this.socket.on('snap', this.onSnap);
    this.socket.on('match:dead', this.onDead);
    this.socket.on('match:end', this.onEnd);
    this.socket.on('match:left', this.onLeft);
    this.socket.on('disconnect', this.onDisconnect);
    this.bindInput();

    this.pingTimer = window.setInterval(() => {
      const t = performance.now();
      this.socket.timeout(3000).emit('ping:c', Date.now(), (err: Error | null) => {
        if (!err) this.ping = Math.round(performance.now() - t);
      });
    }, 2000);
  }

  get matchId(): string {
    return this.start.matchId;
  }

  get viewPid(): number {
    return this.me?.pid ?? this.you;
  }

  get viewScope(): number {
    return this.me?.scope ?? 1;
  }

  nameOf(pid: number): string {
    return this.start.roster.find((r) => r.pid === pid)?.name ?? '???';
  }

  onSceneReady(scene: GameScene) {
    this.scene = scene;
    for (const l of this.loot.values()) scene.addLoot(l);
    this.flushToScene();
  }

  // ---------------------------------------------------------------- input

  private listen<K extends keyof WindowEventMap>(target: Window, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) {
    target.addEventListener(type, fn as EventListener, opts);
    this.cleanups.push(() => target.removeEventListener(type, fn as EventListener, opts));
  }

  private bindInput() {
    this.listen(window, 'keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      unlockAudio();
      const code = e.code;
      if (code === 'Tab') {
        e.preventDefault();
        this.hud.toggle('inventory');
        return;
      }
      if (code === 'KeyM') return this.hud.toggle('map');
      if (code === 'Escape') {
        if (this.hud.current === 'none') this.hud.toggle('pause');
        else this.hud.closeOverlay();
        return;
      }
      if (e.repeat) return;
      this.keys.add(code);
      if (this.hud.blocking) return;
      switch (code) {
        case 'KeyR': this.action({ t: 'reload' }); break;
        case 'KeyF': this.action({ t: 'interact' }); break;
        case 'Digit1': this.action({ t: 'equip', slot: 'p1' }); break;
        case 'Digit2': this.action({ t: 'equip', slot: 'p2' }); break;
        case 'KeyE': this.action({ t: 'equip', slot: 'pistol' }); break;
        case 'KeyV': this.action({ t: 'equip', slot: 'melee' }); break;
        case 'Digit3': this.action({ t: 'equip', slot: 'grenade' }); break;
        case 'Digit4': this.action({ t: 'equip', slot: 'smoke' }); break;
        case 'KeyQ':
        case 'Digit5': this.action({ t: 'heal' }); break;
        case 'KeyZ': this.cycleScope(); break;
      }
    });
    this.listen(window, 'keyup', (e) => this.keys.delete(e.code));
    this.listen(window, 'blur', () => {
      this.keys.clear();
      this.mouse.down = false;
    });
    if (this.touch) return;
    this.listen(window, 'pointermove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    });
    this.listen(window, 'pointerdown', (e) => {
      unlockAudio();
      if (e.button !== 0 || (e.target as HTMLElement).tagName !== 'CANVAS') return;
      this.mouse.down = true;
    });
    this.listen(window, 'pointerup', (e) => {
      if (e.button === 0) this.mouse.down = false;
    });
    this.listen(window, 'contextmenu', (e) => {
      if ((e.target as HTMLElement).tagName === 'CANVAS') e.preventDefault();
    });
    this.listen(
      window,
      'wheel',
      (e) => {
        if ((e.target as HTMLElement).tagName !== 'CANVAS' || !this.me) return;
        const owned = WEAPON_CYCLE.filter((s) => s === 'melee' || this.me![s as 'p1']);
        const idx = Math.max(0, owned.indexOf(this.me.active));
        const next = owned[(idx + (e.deltaY > 0 ? 1 : owned.length - 1)) % owned.length];
        this.action({ t: 'equip', slot: next });
      },
      { passive: true },
    );
  }

  private onTouchButton(b: TouchButton) {
    unlockAudio();
    switch (b) {
      case 'reload': return this.action({ t: 'reload' });
      case 'interact': return this.action({ t: 'interact' });
      case 'heal': return this.action({ t: 'heal' });
      case 'grenade': return this.action({ t: 'equip', slot: this.me?.active === 'grenade' ? (this.lastGun() ?? 'melee') : 'grenade' });
      case 'smoke': return this.action({ t: 'equip', slot: this.me?.active === 'smoke' ? (this.lastGun() ?? 'melee') : 'smoke' });
      case 'scope': return this.cycleScope();
      case 'map': return this.hud.toggle('map');
      case 'inventory': return this.hud.toggle('inventory');
      case 'pause': return this.hud.toggle('pause');
    }
  }

  private lastGun(): SlotName | null {
    if (!this.me) return null;
    return (['p1', 'p2', 'pistol'] as const).find((s) => this.me![s]) ?? null;
  }

  private cycleScope() {
    if (!this.me) return;
    const owned = SCOPE_LEVELS.filter((s) => this.me!.scopes.includes(s));
    const idx = owned.indexOf(this.me.scope as (typeof owned)[number]);
    const next = owned[(idx + 1) % owned.length];
    this.action({ t: 'scope', level: next });
    this.hud.center(`Ống nhắm x${next}`, 1000);
  }

  private action(msg: ActionMsg) {
    if (this.ended) return;
    this.socket.emit('action', msg);
  }

  private activeWeapon(me: SelfNet): WeaponId {
    if (me.active === 'p1' || me.active === 'p2' || me.active === 'pistol') return me[me.active]?.w ?? 'fists';
    if (me.active === 'melee') return me.melee;
    return 'fists';
  }

  fixedUpdate(deltaMs: number) {
    this.accumulator = Math.min(this.accumulator + deltaMs, TICK_MS * 5);
    while (this.accumulator >= TICK_MS) {
      this.accumulator -= TICK_MS;
      this.sendInput();
    }
    const decay = Math.exp(-deltaMs / 80);
    this.predOffset.x *= decay;
    this.predOffset.y *= decay;
    this.updatePrompt();
  }

  private sendInput() {
    const me = this.me;
    if (!me || !me.alive || this.spectating || this.ended || !this.predReady) return;
    const blocked = this.hud.blocking;
    let mx = 0;
    let my = 0;
    let fire = false;
    let td = 200;

    if (this.touch) {
      mx = this.touch.move.x;
      my = this.touch.move.y;
      const throwable = me.active === 'grenade' || me.active === 'smoke';
      if (this.touch.aim.active && this.touch.aimMagnitude > 0.15) {
        this.aimAngle = Math.atan2(this.touch.aim.y, this.touch.aim.x);
      } else if (!this.touch.aim.active && (mx || my)) {
        this.aimAngle = Math.atan2(my, mx);
      }
      fire = throwable ? this.touch.consumeRelease() : this.touch.fireHeld;
      if (!throwable) this.touch.consumeRelease();
      td = Math.max(0.15, this.touch.lastThrowMagnitude) * THROWABLE.maxDistance;
    } else {
      if (!blocked) {
        if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) my -= 1;
        if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) my += 1;
        if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
        if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
        fire = this.mouse.down;
      }
      const cam = this.scene?.cameras.main;
      if (cam) {
        const dpr = this.game.scale.width / window.innerWidth;
        const world = cam.getWorldPoint(this.mouse.x * dpr, this.mouse.y * dpr);
        const vx = this.pred.x + this.predOffset.x;
        const vy = this.pred.y + this.predOffset.y;
        this.aimAngle = Math.atan2(world.y - vy, world.x - vx);
        td = Math.hypot(world.x - vx, world.y - vy);
      }
    }
    if (blocked) {
      mx = 0;
      my = 0;
      fire = false;
    }

    const input: InputMsg = { s: ++this.seq, mx, my, a: this.aimAngle, f: fire, td: Math.min(td, THROWABLE.maxDistance) };
    this.socket.emit('input', input);
    const speed = playerSpeed(this.activeWeapon(me), me.healLeft > 0);
    this.pred = stepMovement(this.world, this.pred.x, this.pred.y, mx, my, speed, TICK_S);
    this.pending.push(input);
    if (this.pending.length > 90) this.pending.shift();
  }

  private updatePrompt() {
    const now = performance.now();
    if (now - this.lastPrompt < 100) return;
    this.lastPrompt = now;
    const me = this.me;
    if (!me || !me.alive || this.spectating) {
      this.hud.prompt(null);
      this.touch?.setInteractLabel(null);
      return;
    }
    const { x, y } = this.viewPosition();
    let best: { d: number; text: string } | null = null;
    for (const [, item, lx, ly, amount] of this.loot.values()) {
      const d = Math.hypot(lx - x, ly - y);
      if (d <= PICKUP_RANGE && (!best || d < best.d)) {
        const def = ITEMS[item];
        best = { d, text: `Nhặt ${def.name}${def.kind === 'ammo' ? ` ×${amount}` : ''}` };
      }
    }
    for (const door of this.map.doors) {
      const d = Math.hypot(door.x + door.w / 2 - x, door.y + door.h / 2 - y) + 10;
      if (d <= INTERACT_RANGE + 10 && (!best || d < best.d)) best = { d, text: this.world.doorOpen[door.id] ? 'Đóng cửa' : 'Mở cửa' };
    }
    for (const [, ax, ay, landed] of this.airdrops) {
      const d = Math.hypot(ax - x, ay - y);
      if (landed && d <= INTERACT_RANGE + AIRDROP_SIZE / 2 && (!best || d < best.d)) best = { d, text: 'Mở thính' };
    }
    const label = best ? best.text : null;
    this.hud.prompt(label ? `${this.touch ? '' : '<span class="kbd">F</span> '}${esc(label)}` : null);
    this.touch?.setInteractLabel(label);
  }

  // ---------------------------------------------------------------- networking

  private onSnap = (snap: SnapshotMsg) => {
    const now = performance.now();
    const offset = snap.t - now;
    this.serverOffset = this.serverOffset === null || offset > this.serverOffset ? offset : this.serverOffset * 0.98 + offset * 0.02;

    this.me = snap.me;
    this.spectating = snap.spectating;
    this.zone = snap.z;
    this.smokes = snap.sm;
    this.throwables = snap.g;
    this.airdrops = snap.ad;
    this.alive = snap.alive;

    const players = new Map<number, PlayerNet>();
    for (const p of snap.p) players.set(p[0], p);
    this.buffer.push({ t: snap.t, players });
    while (this.buffer.length > 2 && this.buffer[1].t < snap.t - 1000) this.buffer.shift();

    if (snap.la) for (const l of snap.la) {
      this.loot.set(l[0], l);
      this.pendingLoot.add.push(l);
    }
    if (snap.ld) for (const id of snap.ld) {
      this.loot.delete(id);
      this.pendingLoot.del.push(id);
    }
    if (snap.e) this.pendingEvents.push(...snap.e);

    if (!snap.spectating && snap.me.alive) this.reconcile(snap);
    else this.predReady = false;

    this.flushToScene();
    const pos = this.viewPosition();
    this.hud.update(snap.me, snap.alive, snap.z, snap.ad, snap.spectating, pos.x, pos.y);
  };

  private reconcile(snap: SnapshotMsg) {
    const me = snap.me;
    this.pending = this.pending.filter((i) => i.s > snap.seq);
    if (!this.predReady) {
      this.pred = { x: me.x, y: me.y };
      this.predOffset = { x: 0, y: 0 };
      this.predReady = true;
      this.aimAngle = me.a;
      return;
    }
    const speed = playerSpeed(this.activeWeapon(me), me.healLeft > 0);
    let pos = { x: me.x, y: me.y };
    for (const input of this.pending) pos = stepMovement(this.world, pos.x, pos.y, input.mx, input.my, speed, TICK_S);
    const ex = this.pred.x - pos.x;
    const ey = this.pred.y - pos.y;
    const err = Math.hypot(ex, ey);
    if (err > 250) {
      this.predOffset = { x: 0, y: 0 };
    } else if (err > 0.5) {
      this.predOffset.x += ex;
      this.predOffset.y += ey;
    }
    this.pred = pos;
  }

  private flushToScene() {
    const scene = this.scene;
    if (!scene) return;
    for (const id of this.pendingLoot.del) scene.removeLoot(id);
    for (const l of this.pendingLoot.add) scene.addLoot(l);
    this.pendingLoot = { add: [], del: [] };
    const listener = this.viewPosition();
    for (const e of this.pendingEvents) {
      this.applyWorldEvent(e);
      scene.handleEvent(e, listener);
    }
    this.pendingEvents = [];
  }

  private applyWorldEvent(e: GameEvent) {
    switch (e.k) {
      case 'door':
        this.world.doorOpen[e.id] = e.open;
        break;
      case 'chest':
        this.world.chestAlive[e.id] = false;
        break;
      case 'kill':
        this.hud.killFeed(e.killer, e.victim, e.w);
        if (e.killer === this.you && e.victim !== this.you) {
          this.hud.center(`Bạn đã hạ gục ${this.nameOf(e.victim)} bằng ${weaponName(e.w)}`);
          sfx.kill();
        }
        break;
      case 'hurt':
        this.hud.hurt();
        sfx.hurt();
        break;
      case 'pickup': {
        const def = ITEMS[e.item];
        this.hud.feed(`Đã nhặt <b>${esc(def.name)}</b>${def.kind === 'ammo' ? ` ×${e.amount}` : ''}`);
        sfx.pickup(e.item);
        break;
      }
      case 'notice':
        this.hud.center(e.text);
        break;
      case 'airdrop':
        this.hud.center('📦 Thính sắp rơi! Xem vị trí trên bản đồ (M).', 4000);
        sfx.alert();
        break;
    }
  }

  private onDead = (msg: DeathMsg) => {
    if (this.ended) return;
    const killerAlive = msg.killer >= 0 && msg.killer !== this.you;
    this.hud.showDeath(msg, killerAlive);
  };

  private onEnd = (msg: MatchEndMsg) => {
    this.ended = true;
    if (msg.placement === 1) sfx.victory();
    this.hud.showEnd(msg, () => this.exit());
  };

  private onLeft = () => this.exit();

  private onDisconnect = () => {
    if (this.ended) return;
    toast('Mất kết nối tới máy chủ, đang kết nối lại…', 'error', 4000);
  };

  private leave() {
    if (this.ended) return this.exit();
    this.socket.emit('match:leave');
    window.setTimeout(() => this.exit(), 1500);
  }

  private exit() {
    if (this.destroyed) return;
    this.destroy();
    this.onExit();
  }

  // ---------------------------------------------------------------- rendering helpers

  viewPosition(): { x: number; y: number } {
    if (this.me && this.me.alive && !this.spectating && this.predReady) {
      return { x: this.pred.x + this.predOffset.x, y: this.pred.y + this.predOffset.y };
    }
    const p = this.interpolate(this.viewPid);
    if (p) return { x: p.x, y: p.y };
    return { x: this.me?.x ?? 0, y: this.me?.y ?? 0 };
  }

  private renderTime(): number {
    return performance.now() + (this.serverOffset ?? 0) - INTERPOLATION_DELAY_MS;
  }

  private interpolate(pid: number): RenderPlayer | null {
    const buf = this.buffer;
    if (!buf.length) return null;
    const t = this.renderTime();
    let i = buf.length - 1;
    while (i > 0 && buf[i - 1].t > t) i--;
    const b = buf[i];
    const a = i > 0 ? buf[i - 1] : b;
    const pb = b.players.get(pid);
    if (!pb) return null;
    const pa = a.players.get(pid) ?? pb;
    const span = b.t - a.t;
    const k = span > 0 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 1;
    return {
      pid,
      x: pa[1] + (pb[1] - pa[1]) * k,
      y: pa[2] + (pb[2] - pa[2]) * k,
      a: GameScene.lerpAngle(pa[3], pb[3], k),
      weapon: pb[4],
      armor: pb[5],
      bag: pb[6],
      flags: pb[7],
    };
  }

  interpolatedPlayers(): RenderPlayer[] {
    const latest = this.buffer[this.buffer.length - 1];
    if (!latest) return [];
    const out: RenderPlayer[] = [];
    const t = this.renderTime();
    let idx = this.buffer.length - 1;
    while (idx > 0 && this.buffer[idx - 1].t > t) idx--;
    const visible = this.buffer[idx].players;
    for (const pid of visible.keys()) {
      if (pid === this.you && this.me?.alive && !this.spectating && this.predReady && this.me) {
        const self = visible.get(pid)!;
        out.push({
          pid,
          x: this.pred.x + this.predOffset.x,
          y: this.pred.y + this.predOffset.y,
          a: this.aimAngle,
          weapon: this.activeWeapon(this.me),
          armor: this.me.armor,
          bag: this.me.bag,
          flags: self[7],
        });
        continue;
      }
      const p = this.interpolate(pid);
      if (p) out.push(p);
    }
    if (this.me?.alive && !this.spectating && this.predReady && !visible.has(this.you)) {
      out.push({
        pid: this.you, x: this.pred.x + this.predOffset.x, y: this.pred.y + this.predOffset.y, a: this.aimAngle,
        weapon: this.activeWeapon(this.me), armor: this.me.armor, bag: this.me.bag, flags: 0,
      });
    }
    return out;
  }

  get aliveCount(): number {
    return this.alive;
  }

  private destroyed = false;

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    window.clearInterval(this.pingTimer);
    this.socket.off('snap', this.onSnap);
    this.socket.off('match:dead', this.onDead);
    this.socket.off('match:end', this.onEnd);
    this.socket.off('match:left', this.onLeft);
    this.socket.off('disconnect', this.onDisconnect);
    for (const fn of this.cleanups) fn();
    this.touch?.destroy();
    this.hud.destroy();
    stopAmbient();
    this.game.destroy(true);
  }
}
