import Phaser from 'phaser';
import {
  BASE_VIEW_DIAGONAL,
  CHEST_SIZE,
  ITEMS,
  MAP_SIZE,
  PLAYER_RADIUS,
  SCOPE_VIEW_MULTIPLIER,
  WALL_THICKNESS,
  WEAPONS,
  angleDiff,
  roomAt,
  PFLAG_DISCONNECTED,
  PFLAG_HEALING,
  type ArmorLevel,
  type BagLevel,
  type GameEvent,
  type ItemId,
  type LootNet,
  type ScopeLevel,
  type WeaponId,
} from '../shared';
import { settings } from '../settings';
import { falloff, sfx } from './audio';
import type { GameSession } from './session';

const ARMOR_COLORS = [0, 0xc9d6e0, 0x3fa3ff, 0x2b2f6b];
const BAG_COLORS = [0, 0xc98a3d, 0x4fae3a, 0x8a4fd6];
const SKIN = 0xffcf9e;
const OUTLINE = 0x10284d;

interface Tracer {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  speed: number;
  maxDist: number;
  born: number;
  width: number;
  color: number;
}

class PlayerView {
  readonly container: Phaser.GameObjects.Container;
  readonly label: Phaser.GameObjects.Text | null;
  private readonly body: Phaser.GameObjects.Arc;
  private readonly armorRing: Phaser.GameObjects.Arc;
  private readonly bag: Phaser.GameObjects.Arc;
  private readonly handL: Phaser.GameObjects.Arc;
  private readonly handR: Phaser.GameObjects.Arc;
  private readonly gun: Phaser.GameObjects.Rectangle;
  private readonly healRing: Phaser.GameObjects.Arc;
  private weapon: WeaponId | null = null;
  private armor: ArmorLevel = 0;
  private bagLevel: BagLevel = 0;
  lastSeen = 0;
  private punching = 0;

  constructor(scene: Phaser.Scene, readonly pid: number, name: string | null, isSelf: boolean) {
    this.bag = scene.add.circle(-16, 0, 13, 0x000000).setVisible(false);
    this.gun = scene.add.rectangle(30, 0, 40, 7, 0x333333).setOrigin(0, 0.5).setStrokeStyle(2, OUTLINE);
    this.handL = scene.add.circle(14, -16, 7, SKIN).setStrokeStyle(2.5, OUTLINE);
    this.handR = scene.add.circle(14, 16, 7, SKIN).setStrokeStyle(2.5, OUTLINE);
    this.body = scene.add.circle(0, 0, PLAYER_RADIUS, SKIN).setStrokeStyle(isSelf ? 4 : 3, isSelf ? 0xffc21a : OUTLINE);
    this.armorRing = scene.add.circle(0, 0, PLAYER_RADIUS - 5).setStrokeStyle(5, 0x000000).setVisible(false);
    this.healRing = scene.add.circle(0, 0, PLAYER_RADIUS + 6).setStrokeStyle(3, 0x5cff7a, 0.8).setVisible(false);
    this.container = scene.add.container(0, 0, [this.bag, this.gun, this.handL, this.handR, this.body, this.armorRing, this.healRing]);
    this.container.setDepth(10);
    this.label = name
      ? scene.add
          .text(0, 0, name, { fontFamily: "'Baloo 2', sans-serif", fontSize: '15px', fontStyle: 'bold', color: isSelf ? '#ffe066' : '#ffffff', stroke: '#10284d', strokeThickness: 4 })
          .setOrigin(0.5, 1)
          .setDepth(60)
      : null;
  }

  update(x: number, y: number, a: number, weapon: WeaponId, armor: ArmorLevel, bag: BagLevel, flags: number, dt: number) {
    this.container.setPosition(x, y);
    this.container.rotation = a;
    this.label?.setPosition(x, y - PLAYER_RADIUS - 8);
    if (weapon !== this.weapon) this.setWeapon(weapon);
    if (armor !== this.armor) {
      this.armor = armor;
      this.armorRing.setVisible(armor > 0).setStrokeStyle(5, ARMOR_COLORS[armor], 0.9);
    }
    if (bag !== this.bagLevel) {
      this.bagLevel = bag;
      this.bag.setVisible(bag > 0).setFillStyle(BAG_COLORS[bag]).setStrokeStyle(2.5, OUTLINE);
    }
    this.healRing.setVisible((flags & PFLAG_HEALING) !== 0);
    const alpha = flags & PFLAG_DISCONNECTED ? 0.45 : 1;
    this.container.setAlpha(alpha);
    if (this.punching > 0) {
      this.punching = Math.max(0, this.punching - dt);
      const k = Math.sin((1 - this.punching / 160) * Math.PI);
      const melee = weapon === 'fists' || weapon === 'knife';
      if (melee) this.handR.x = 14 + k * 18;
    }
  }

  private setWeapon(w: WeaponId) {
    this.weapon = w;
    const def = WEAPONS[w];
    if (def.slot === 'melee') {
      this.handL.setPosition(14, -16);
      this.handR.setPosition(14, 16);
      if (w === 'knife') {
        this.gun.setVisible(true).setPosition(18, 16).setSize(22, 4).setFillStyle(def.color);
      } else {
        this.gun.setVisible(false);
      }
      return;
    }
    const length = w === 'pistol' ? 22 : w === 'shotgun' ? 42 : w === 'sniper' ? 62 : 48;
    this.gun.setVisible(true).setPosition(16, 0).setSize(length, w === 'pistol' ? 7 : 8).setFillStyle(def.color);
    if (w === 'pistol') {
      this.handL.setPosition(22, -3);
      this.handR.setPosition(22, 3);
    } else {
      this.handL.setPosition(20, 5);
      this.handR.setPosition(16 + length * 0.6, -3);
    }
  }

  punch() {
    this.punching = 160;
  }

  muzzle(): { x: number; y: number } {
    const len = this.weapon && WEAPONS[this.weapon].slot !== 'melee' ? 16 + this.gun.width : PLAYER_RADIUS;
    return {
      x: this.container.x + Math.cos(this.container.rotation) * len,
      y: this.container.y + Math.sin(this.container.rotation) * len,
    };
  }

  destroy() {
    this.container.destroy();
    this.label?.destroy();
  }
}

export class GameScene extends Phaser.Scene {
  private players = new Map<number, PlayerView>();
  private lootViews = new Map<number, Phaser.GameObjects.Container>();
  private doorViews = new Map<number, Phaser.GameObjects.Rectangle>();
  private chestViews = new Map<number, Phaser.GameObjects.Container>();
  private roofs = new Map<number, Phaser.GameObjects.Rectangle>();
  private canopies: { img: Phaser.GameObjects.Image; x: number; y: number; r: number }[] = [];
  private throwViews = new Map<number, Phaser.GameObjects.Arc>();
  private smokeViews = new Map<number, Phaser.GameObjects.Arc>();
  private airdropViews = new Map<number, Phaser.GameObjects.Container>();
  private tracers: Tracer[] = [];
  private tracerGfx!: Phaser.GameObjects.Graphics;
  private zoneGfx!: Phaser.GameObjects.Graphics;
  private currentZoom = 1;
  private fpsTimer = 0;

  constructor(private readonly session: GameSession) {
    super({ key: 'game' });
  }

  create() {
    this.makeTextures();
    const map = this.session.map;
    this.cameras.main.setBackgroundColor('#2f9be0');

    const shore = this.add.graphics().setDepth(-1);
    shore.fillStyle(0x6cc4f0, 1);
    shore.fillRoundedRect(-150, -150, MAP_SIZE + 300, MAP_SIZE + 300, 160);
    shore.fillStyle(0xf6dc95, 1);
    shore.fillRoundedRect(-80, -80, MAP_SIZE + 160, MAP_SIZE + 160, 90);

    this.add.tileSprite(0, 0, MAP_SIZE, MAP_SIZE, 'grass').setOrigin(0, 0).setDepth(0);

    const decor = this.add.graphics().setDepth(1);
    for (const d of map.decor) {
      decor.fillStyle(d.color, 0.45);
      decor.fillCircle(d.x, d.y, d.r);
    }
    decor.lineStyle(8, 0x4f9a2c, 1);
    decor.strokeRect(0, 0, MAP_SIZE, MAP_SIZE);

    const floors = this.add.graphics().setDepth(2);
    for (const h of map.houses) {
      floors.fillStyle(h.floor, 1);
      floors.fillRect(h.x, h.y, h.w, h.h);
      floors.lineStyle(2, 0x8a5a2b, 0.25);
      for (let y = h.y + 28; y < h.y + h.h; y += 28) floors.lineBetween(h.x, y, h.x + h.w, y);
    }

    const solid = this.add.graphics().setDepth(5);
    for (const w of map.walls) {
      solid.fillStyle(w.houseId >= 0 ? 0xf7ead0 : 0xb9c4cc, 1);
      solid.fillRect(w.x, w.y, w.w, w.h);
      solid.lineStyle(3, w.houseId >= 0 ? 0x6b3e1e : 0x3e4a56, 1);
      solid.strokeRect(w.x, w.y, w.w, w.h);
    }
    for (const r of map.rocks) {
      solid.fillStyle(0x000000, 0.18);
      solid.fillCircle(r.x + 5, r.y + 7, r.r);
      solid.fillStyle(0xa9b7c2, 1);
      solid.fillCircle(r.x, r.y, r.r);
      solid.fillStyle(0xd4dee6, 1);
      solid.fillCircle(r.x - r.r * 0.22, r.y - r.r * 0.24, r.r * 0.58);
      solid.fillStyle(0xf2f7fa, 0.9);
      solid.fillCircle(r.x - r.r * 0.38, r.y - r.r * 0.4, r.r * 0.18);
      solid.lineStyle(4, 0x3e4a56, 1);
      solid.strokeCircle(r.x, r.y, r.r);
    }
    for (const t of map.trees) {
      solid.fillStyle(0x8a5a2b, 1);
      solid.fillCircle(t.x, t.y, t.r);
      solid.lineStyle(3, 0x4a2c10, 1);
      solid.strokeCircle(t.x, t.y, t.r);
      const canopyR = t.r * 2.4;
      const img = this.add.image(t.x, t.y, 'canopy').setDisplaySize(canopyR * 2, canopyR * 2).setDepth(20);
      img.rotation = (t.id * 1.7) % (Math.PI * 2);
      this.canopies.push({ img, x: t.x, y: t.y, r: canopyR });
    }

    for (const d of map.doors) {
      const rect = this.add.rectangle(d.x + d.w / 2, d.y + d.h / 2, d.w, d.h, 0xc77a3a).setStrokeStyle(3, 0x5a3010).setDepth(4);
      this.doorViews.set(d.id, rect);
      this.setDoor(d.id, this.session.world.doorOpen[d.id]);
    }

    for (const c of map.chests) {
      if (!this.session.world.chestAlive[c.id]) continue;
      const box = this.add.rectangle(0, 0, CHEST_SIZE, CHEST_SIZE, 0xd9893a).setStrokeStyle(4, 0x5a2e0a);
      const band = this.add.rectangle(0, 0, CHEST_SIZE, 9, 0x8a4a14);
      const lock = this.add.rectangle(0, 0, 12, 14, 0xffd23f).setStrokeStyle(2, 0x5a2e0a);
      const cont = this.add.container(c.x, c.y, [box, band, lock]).setDepth(5);
      this.chestViews.set(c.id, cont);
    }

    for (const room of map.rooms) {
      const house = map.houses[room.houseId];
      const roof = this.add
        .rectangle(room.x + room.w / 2, room.y + room.h / 2, room.w + WALL_THICKNESS, room.h + WALL_THICKNESS, house.roof)
        .setStrokeStyle(5, 0x10284d, 0.55)
        .setDepth(30);
      this.roofs.set(room.id, roof);
    }

    this.tracerGfx = this.add.graphics().setDepth(12);
    this.zoneGfx = this.add.graphics().setDepth(50);

    this.scale.on('resize', (size: Phaser.Structs.Size) => {
      this.cameras.main.setSize(size.width, size.height);
      this.updateZoom(true);
    });
    this.updateZoom(true);
    this.session.onSceneReady(this);
  }

  private makeTextures() {
    if (!this.textures.exists('grass')) {
      const g = this.add.graphics();
      g.fillStyle(0x7ccf4f, 1);
      g.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 70; i++) {
        g.fillStyle(i % 3 === 0 ? 0x9be36a : 0x6cbf3f, 0.9);
        const x = (i * 37) % 128;
        const y = (i * 53) % 128;
        g.fillTriangle(x, y + 6, x + 2, y, x + 4, y + 6);
      }
      g.fillStyle(0xffffff, 0.8);
      g.fillCircle(30, 90, 2);
      g.fillStyle(0xffe066, 0.9);
      g.fillCircle(96, 34, 2);
      g.generateTexture('grass', 128, 128);
      g.destroy();
    }
    if (!this.textures.exists('canopy')) {
      const g = this.add.graphics();
      g.fillStyle(0x1f5e1a, 1);
      g.fillCircle(64, 64, 64);
      g.fillStyle(0x3fa02e, 1);
      g.fillCircle(64, 64, 59);
      g.fillStyle(0x5cc23f, 1);
      g.fillCircle(54, 54, 40);
      g.fillCircle(84, 78, 26);
      g.fillCircle(40, 84, 20);
      g.fillStyle(0x8ee35f, 0.9);
      g.fillCircle(46, 44, 18);
      g.fillCircle(80, 70, 10);
      g.generateTexture('canopy', 128, 128);
      g.destroy();
    }
  }

  setDoor(id: number, open: boolean) {
    const rect = this.doorViews.get(id);
    if (!rect) return;
    rect.setAlpha(open ? 0.25 : 1);
    rect.setFillStyle(open ? 0xf0c890 : 0xc77a3a);
  }

  removeChest(id: number) {
    const view = this.chestViews.get(id);
    if (!view) return;
    this.chestViews.delete(id);
    this.tweens.add({ targets: view, scale: 1.4, alpha: 0, duration: 250, onComplete: () => view.destroy() });
    this.particles(view.x, view.y, 0xa8732e, 10);
  }

  private updateZoom(force = false) {
    const scope = (this.session.viewScope ?? 1) as ScopeLevel;
    const diag = Math.hypot(this.scale.width, this.scale.height);
    const target = diag / (BASE_VIEW_DIAGONAL * SCOPE_VIEW_MULTIPLIER[scope]);
    this.currentZoom = force ? target : this.currentZoom + (target - this.currentZoom) * 0.12;
    this.cameras.main.setZoom(this.currentZoom);
  }

  // ---------------------------------------------------------------- loot

  addLoot(l: LootNet) {
    const [id, item, x, y, amount] = l;
    this.lootViews.get(id)?.destroy();
    const def = ITEMS[item];
    const ring = this.add.circle(0, 0, 19, def.color === 0x333333 ? 0x5a6a7a : def.color).setStrokeStyle(3, OUTLINE);
    const bg = this.add.circle(0, 0, 14, 0xffffff, 0.95);
    const parts: Phaser.GameObjects.GameObject[] = [ring, bg];
    const label = lootShortLabel(item);
    if (label) {
      parts.push(this.add.text(0, 0, label, { fontFamily: "'Baloo 2', sans-serif", fontSize: '12px', fontStyle: 'bold', color: '#10284d' }).setOrigin(0.5));
    } else {
      parts.push(this.add.text(0, 1, def.icon, { fontSize: '17px' }).setOrigin(0.5));
    }
    const levelMatch = /(\d)$/.exec(item);
    if ((def.kind === 'armor' || def.kind === 'bag') && levelMatch) {
      parts.push(this.add.circle(13, -13, 8, 0xffc21a).setStrokeStyle(2, OUTLINE));
      parts.push(this.add.text(13, -13, levelMatch[1], { fontFamily: "'Baloo 2', sans-serif", fontSize: '11px', fontStyle: 'bold', color: '#10284d' }).setOrigin(0.5));
    }
    const name = this.add
      .text(0, 26, def.kind === 'ammo' ? `${def.name} ×${amount}` : def.name, {
        fontFamily: "'Baloo 2', sans-serif", fontSize: '13px', fontStyle: 'bold', color: '#fff', stroke: '#10284d', strokeThickness: 4,
      })
      .setOrigin(0.5, 0)
      .setVisible(false);
    name.setName('name');
    parts.push(name);
    const cont = this.add.container(x, y, parts).setDepth(3);
    this.lootViews.set(id, cont);
  }

  removeLoot(id: number) {
    this.lootViews.get(id)?.destroy();
    this.lootViews.delete(id);
  }

  // ---------------------------------------------------------------- events

  handleEvent(e: GameEvent, listener: { x: number; y: number }) {
    const vol = (x: number, y: number) => falloff(Math.hypot(x - listener.x, y - listener.y));
    switch (e.k) {
      case 'shot': {
        const view = this.players.get(e.pid);
        const origin = view && e.pid !== this.session.viewPid ? view.muzzle() : { x: e.x, y: e.y };
        const dx = Math.cos(e.a);
        const dy = Math.sin(e.a);
        const hit = this.session.world.raycast(e.x, e.y, e.x + dx * e.rng, e.y + dy * e.rng);
        const maxDist = hit ? hit.t * e.rng : e.rng;
        this.tracers.push({
          id: e.id, x: e.x, y: e.y, dx, dy, speed: e.spd, maxDist, born: performance.now(),
          width: e.w === 'sniper' ? 3 : 2, color: e.w === 'sniper' ? 0xbfe6ff : 0xfff1a8,
        });
        this.flash(origin.x + dx * 6, origin.y + dy * 6);
        sfx.shot(e.w, vol(e.x, e.y));
        if (e.pid === this.session.viewPid && settings.screenShake && (e.w === 'shotgun' || e.w === 'sniper')) {
          this.cameras.main.shake(80, 0.003);
        }
        break;
      }
      case 'bulletEnd': {
        const t = this.tracers.find((tr) => tr.id === e.id);
        if (t) t.maxDist = Math.min(t.maxDist, Math.hypot(e.x - t.x, e.y - t.y));
        this.particles(e.x, e.y, e.blood ? 0xc0392b : 0xcfcfcf, e.blood ? 6 : 3);
        if (e.blood) sfx.hit(vol(e.x, e.y) * 0.8);
        break;
      }
      case 'melee': {
        this.players.get(e.pid)?.punch();
        const v = this.players.get(e.pid);
        if (v) sfx.melee(vol(v.container.x, v.container.y));
        break;
      }
      case 'boom': {
        const ring = this.add.circle(e.x, e.y, 20, 0xff9a2e, 0.85).setDepth(46);
        this.tweens.add({ targets: ring, radius: 170, alpha: 0, duration: 450, onComplete: () => ring.destroy() });
        this.particles(e.x, e.y, 0x555555, 14, 120);
        sfx.boom(vol(e.x, e.y));
        const d = Math.hypot(e.x - listener.x, e.y - listener.y);
        if (settings.screenShake && d < 700) this.cameras.main.shake(300, 0.012 * (1 - d / 700));
        break;
      }
      case 'reload': {
        const v = this.players.get(e.pid);
        if (v) sfx.reload(vol(v.container.x, v.container.y));
        break;
      }
      case 'throw': {
        const v = this.players.get(e.pid);
        if (v) sfx.throwItem(vol(v.container.x, v.container.y));
        break;
      }
      case 'door': {
        this.setDoor(e.id, e.open);
        const d = this.session.map.doors[e.id];
        sfx.door(vol(d.x, d.y));
        break;
      }
      case 'chest':
        this.removeChest(e.id);
        break;
      case 'dmg':
        if (settings.damageNumbers) this.floatText(e.x, e.y - 20, String(e.n), '#ffe066');
        sfx.hit(0.9);
        break;
      default:
        break;
    }
  }

  private flash(x: number, y: number) {
    const f = this.add.circle(x, y, 9, 0xfff3a0, 0.9).setDepth(13);
    this.tweens.add({ targets: f, alpha: 0, scale: 0.4, duration: 70, onComplete: () => f.destroy() });
  }

  private particles(x: number, y: number, color: number, n: number, spread = 30) {
    if (settings.quality === 'low') n = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) {
      const p = this.add.circle(x, y, 2 + Math.random() * 3, color, 0.9).setDepth(15);
      const ang = Math.random() * Math.PI * 2;
      const d = spread * (0.4 + Math.random());
      this.tweens.add({
        targets: p, x: x + Math.cos(ang) * d, y: y + Math.sin(ang) * d, alpha: 0,
        duration: 250 + Math.random() * 250, onComplete: () => p.destroy(),
      });
    }
  }

  private floatText(x: number, y: number, text: string, color: string) {
    const t = this.add
      .text(x + (Math.random() - 0.5) * 20, y, text, { fontFamily: "'Baloo 2', sans-serif", fontSize: '22px', fontStyle: 'bold', color, stroke: '#7a3800', strokeThickness: 5 })
      .setOrigin(0.5)
      .setDepth(61);
    this.tweens.add({ targets: t, y: y - 40, alpha: 0, duration: 700, onComplete: () => t.destroy() });
  }

  // ---------------------------------------------------------------- frame

  update(_time: number, delta: number) {
    const s = this.session;
    s.fixedUpdate(delta);
    const view = s.viewPosition();
    const now = performance.now();

    const seen = new Set<number>();
    for (const p of s.interpolatedPlayers()) {
      seen.add(p.pid);
      let v = this.players.get(p.pid);
      if (!v) {
        const isSelf = p.pid === s.you;
        v = new PlayerView(this, p.pid, isSelf ? null : s.nameOf(p.pid), isSelf);
        this.players.set(p.pid, v);
      }
      v.lastSeen = now;
      v.update(p.x, p.y, p.a, p.weapon, p.armor, p.bag, p.flags, delta);
      v.container.setVisible(true);
      v.label?.setVisible(true);
    }
    for (const [pid, v] of this.players) {
      if (seen.has(pid)) continue;
      v.container.setVisible(false);
      v.label?.setVisible(false);
      if (now - v.lastSeen > 3000) {
        v.destroy();
        this.players.delete(pid);
      }
    }

    this.updateZoom();
    this.cameras.main.centerOn(view.x, view.y);

    const room = roomAt(s.map, view.x, view.y);
    for (const [id, roof] of this.roofs) {
      const target = id === room ? 0 : 1;
      roof.alpha += (target - roof.alpha) * Math.min(1, delta / 80);
    }
    for (const c of this.canopies) {
      const under = (c.x - view.x) ** 2 + (c.y - view.y) ** 2 < (c.r * 0.85) ** 2;
      const target = under ? 0.45 : 1;
      c.img.alpha += (target - c.img.alpha) * Math.min(1, delta / 100);
    }

    for (const cont of this.lootViews.values()) {
      const near = Math.abs(cont.x - view.x) < 110 && Math.abs(cont.y - view.y) < 110;
      (cont.getByName('name') as Phaser.GameObjects.Text | null)?.setVisible(near);
    }

    this.drawTracers(now);
    this.syncThrowables();
    this.syncSmokes();
    this.syncAirdrops();
    this.drawZone();

    this.fpsTimer += delta;
    if (this.fpsTimer > 500) {
      this.fpsTimer = 0;
      s.hud.fps(settings.showFps ? `${Math.round(this.game.loop.actualFps)} FPS · ping ${s.ping} ms` : null);
    }
  }

  private drawTracers(now: number) {
    const g = this.tracerGfx;
    g.clear();
    this.tracers = this.tracers.filter((t) => {
      const traveled = ((now - t.born) / 1000) * t.speed;
      const head = Math.min(traveled, t.maxDist);
      const tail = Math.max(0, traveled - 90);
      if (tail >= t.maxDist) return false;
      g.lineStyle(t.width, t.color, 0.9);
      g.lineBetween(t.x + t.dx * tail, t.y + t.dy * tail, t.x + t.dx * head, t.y + t.dy * head);
      return true;
    });
  }

  private syncThrowables() {
    const seen = new Set<number>();
    for (const [id, kind, x, y] of this.session.throwables) {
      seen.add(id);
      let v = this.throwViews.get(id);
      if (!v) {
        v = this.add.circle(x, y, 8, kind === 0 ? 0x3d5a1e : 0xbbbbbb).setStrokeStyle(2, 0x111111).setDepth(13);
        this.throwViews.set(id, v);
      }
      v.x += (x - v.x) * 0.35;
      v.y += (y - v.y) * 0.35;
      if (kind === 0) v.setFillStyle(Math.floor(performance.now() / 150) % 2 ? 0x3d5a1e : 0xd63b3b);
    }
    for (const [id, v] of this.throwViews) {
      if (!seen.has(id)) {
        v.destroy();
        this.throwViews.delete(id);
      }
    }
  }

  private syncSmokes() {
    const seen = new Set<number>();
    for (const [id, x, y, r] of this.session.smokes) {
      seen.add(id);
      let v = this.smokeViews.get(id);
      if (!v) {
        v = this.add.circle(x, y, Math.max(1, r), 0xd9d9d9, 0.92).setDepth(40);
        this.smokeViews.set(id, v);
      }
      v.radius += (Math.max(1, r) - v.radius) * 0.3;
    }
    for (const [id, v] of this.smokeViews) {
      if (seen.has(id)) continue;
      this.smokeViews.delete(id);
      this.tweens.add({ targets: v, alpha: 0, duration: 600, onComplete: () => v.destroy() });
    }
  }

  private syncAirdrops() {
    const seen = new Set<number>();
    for (const [id, x, y, landed, msLeft] of this.session.airdrops) {
      seen.add(id);
      let v = this.airdropViews.get(id);
      if (!v) {
        const crate = this.add.rectangle(0, 0, 64, 64, 0x2f6fbf).setStrokeStyle(4, 0x13355c);
        const c1 = this.add.rectangle(0, 0, 64, 10, 0xf4b63f);
        const c2 = this.add.rectangle(0, 0, 10, 64, 0xf4b63f);
        const chute = this.add.circle(0, -10, 60, 0xffffff, 0.75).setStrokeStyle(3, 0xe35151);
        chute.setName('chute');
        const shadow = this.add.circle(0, 0, 40, 0x000000, 0.25);
        shadow.setName('shadow');
        v = this.add.container(x, y, [shadow, crate, c1, c2, chute]).setDepth(9);
        this.airdropViews.set(id, v);
      }
      const chute = v.getByName('chute') as Phaser.GameObjects.Arc;
      const shadow = v.getByName('shadow') as Phaser.GameObjects.Arc;
      if (landed) {
        chute.setVisible(false);
        shadow.setVisible(false);
        v.setScale(1).setDepth(6);
      } else {
        const k = Math.min(1, msLeft / 20000);
        v.setScale(1 + k * 0.8);
        v.setAlpha(1 - k * 0.5);
        chute.setVisible(true);
      }
    }
    for (const [id, v] of this.airdropViews) {
      if (!seen.has(id)) {
        v.destroy();
        this.airdropViews.delete(id);
      }
    }
  }

  private drawZone() {
    const z = this.session.zone;
    const g = this.zoneGfx;
    g.clear();
    if (!z) return;
    const [x, y, r, tx, ty, tr] = z;
    const band = 9000;
    g.lineStyle(band, 0x2a4fd6, 0.28);
    g.strokeCircle(x, y, r + band / 2);
    g.lineStyle(5, 0x8fb8ff, 0.95);
    g.strokeCircle(x, y, Math.max(0, r));
    g.lineStyle(3, 0xffffff, 0.85);
    g.strokeCircle(tx, ty, Math.max(0, tr));
  }

  /** Angle difference helper used to keep remote rotation smooth. */
  static lerpAngle(a: number, b: number, k: number): number {
    return a + angleDiff(a, b) * k;
  }
}

function lootShortLabel(item: ItemId): string | null {
  switch (item) {
    case 'ammo_9mm': return '9mm';
    case 'ammo_556': return '5.56';
    case 'ammo_12g': return '12G';
    case 'ammo_762': return '7.62';
    case 'scope2': return 'x2';
    case 'scope3': return 'x3';
    case 'scope4': return 'x4';
    case 'scope6': return 'x6';
    case 'scope8': return 'x8';
    case 'rifle': return 'AR';
    case 'shotgun': return 'SG';
    case 'sniper': return 'SR';
    case 'pistol': return 'P';
    default: return null;
  }
}
