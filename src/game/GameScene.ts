import Phaser from 'phaser';
import {
  BASE_VIEW_DIAGONAL,
  CHEST_SIZE,
  DOOR_WIDTH,
  ITEMS,
  MAP_SIZE,
  PLAYER_RADIUS,
  SCOPE_VIEW_MULTIPLIER,
  WALL_THICKNESS,
  WEAPONS,
  angleDiff,
  doorOutward,
  roomAt,
  PFLAG_DISCONNECTED,
  PFLAG_HEALING,
  type ArmorLevel,
  type BagLevel,
  type Door,
  type GameEvent,
  type ItemId,
  type LootNet,
  type Room,
  type ScopeLevel,
  type WeaponId,
} from '../shared';
import { settings } from '../settings';
import { sfx, spotAt, startAmbient, stopAmbient } from './audio';
import { RARITY_COLOR, iconImages, iconTextureKey, rarityOf } from './icons';
import type { GameSession } from './session';
import { CHEST_BODY, PROP_RADIUS, TEX, TRUNK_RADIUS, makeWorldTextures } from './worldArt';

const ARMOR_COLORS = [0, 0xc9d6e0, 0x3fa3ff, 0x2b2f6b];
const BAG_COLORS = [0, 0xc98a3d, 0x4fae3a, 0x8a4fd6];
const ZOOM_EASE_MS = 90;
const DOOR_WOOD = 0xc77a3a;
const DOOR_FRAME = 0x5a3010;
const DOOR_GAP = 0x3b2410;
const SKIN = 0xf0c08a;

const OUTLINE = 0x2a1a0e;
const BAMBOO_WALL = 0xb98d52;
const BAMBOO_WALL_EDGE = 0x5c3a1a;
const DARK_WOOD = 0x5a3a18;
/** Tree kinds by id, roughly 4 bamboo : 3 areca : 3 banana. */
const TREE_KINDS = ['bamboo', 'bamboo', 'areca', 'banana', 'areca', 'bamboo', 'banana', 'areca', 'bamboo', 'banana'] as const;
/** Small rocks read better as clay jars; big ones stay limestone boulders. */
const JAR_MAX_RADIUS = 42;

/** Maps (along, across) offsets relative to an anchor, where `along` follows the unit vector (dx, dy). */
function axis(x: number, y: number, dx: number, dy: number) {
  return (along: number, across: number) => ({ x: x + dx * along - dy * across, y: y + dy * along + dx * across });
}

/** Landing and wooden ladder of a stilt house outside an exterior door; (dx, dy) points away from the house. */
function drawLadder(g: Phaser.GameObjects.Graphics, d: Door, dx: number, dy: number) {
  const at = axis(d.x + d.w / 2, d.y + d.h / 2, dx, dy);
  const line = (a: { x: number; y: number }, b: { x: number; y: number }, width: number, color: number) => {
    g.lineStyle(width + 2.5, OUTLINE, 1);
    g.lineBetween(a.x, a.y, b.x, b.y);
    g.lineStyle(width, color, 1);
    g.lineBetween(a.x, a.y, b.x, b.y);
  };
  const base = WALL_THICKNESS / 2;
  const span = DOOR_WIDTH / 2 + 8;
  const p0 = at(base, -span);
  const p1 = at(base + 11, span);
  const lx = Math.min(p0.x, p1.x);
  const ly = Math.min(p0.y, p1.y);
  const lw = Math.abs(p1.x - p0.x);
  const lh = Math.abs(p1.y - p0.y);
  g.fillStyle(OUTLINE, 0.22);
  g.fillRect(lx + 3, ly + 4, lw, lh);
  g.fillStyle(0xa8743e, 1);
  g.fillRect(lx, ly, lw, lh);
  g.lineStyle(2.5, OUTLINE, 1);
  g.strokeRect(lx, ly, lw, lh);

  const rail = DOOR_WIDTH / 2 - 12;
  const u0 = base + 11;
  const u1 = base + 42;
  g.lineStyle(6, OUTLINE, 0.22);
  for (const s of [-1, 1]) {
    const a = at(u0, s * rail);
    const b = at(u1, s * rail);
    g.lineBetween(a.x + 3, a.y + 4, b.x + 3, b.y + 4);
  }
  for (const u of [u0 + 7, u0 + 15, u0 + 23]) line(at(u, -rail), at(u, rail), 3.2, 0xc08a52);
  for (const s of [-1, 1]) line(at(u0, s * rail), at(u1, s * rail), 4.5, 0x8a5a30);
}

/** Crossed gable boards sticking out of a boat-shaped ridge, each ending in a bird head. */
function drawGableHorns(g: Phaser.GameObjects.Graphics, x: number, y: number, dx: number, dy: number) {
  const at = axis(x, y, dx, dy);
  for (const s of [-1, 1]) {
    const a = at(-14, -9 * s);
    const b = at(22, 14 * s);
    g.lineStyle(7.5, OUTLINE, 1);
    g.lineBetween(a.x, a.y, b.x, b.y);
    g.lineStyle(4.5, 0x8a5e2e, 1);
    g.lineBetween(a.x, a.y, b.x, b.y);
    g.fillStyle(OUTLINE, 1);
    g.fillCircle(b.x, b.y, 5.5);
    g.fillStyle(0x8a5e2e, 1);
    g.fillCircle(b.x, b.y, 3.5);
  }
}

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
    // Đông Sơn feather headdress fanning out behind the head; it also shows which way the player faces
    const plume = scene.add.image(-PLAYER_RADIUS + 8, 0, TEX.plume).setOrigin(1, 0.5).setDisplaySize(30, 30);
    this.container = scene.add.container(0, 0, [plume, this.bag, this.gun, this.handL, this.handR, this.body, this.armorRing, this.healRing]);
    this.container.setDepth(10);
    this.label = name
      ? scene.add
          .text(0, 0, name, { fontFamily: "'Baloo 2', sans-serif", fontSize: '15px', fontStyle: 'bold', color: isSelf ? '#ffe066' : '#ffffff', stroke: '#2a1a0e', strokeThickness: 4 })
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
  private chestViews = new Map<number, Phaser.GameObjects.Image>();
  private roofs = new Map<number, Phaser.GameObjects.Container>();
  private doorMarks = new Map<number, Phaser.GameObjects.Rectangle[]>();
  private canopies: { img: Phaser.GameObjects.Image; x: number; y: number; r: number }[] = [];
  private throwViews = new Map<number, Phaser.GameObjects.Arc>();
  private smokeViews = new Map<number, Phaser.GameObjects.Arc>();
  private airdropViews = new Map<number, Phaser.GameObjects.Container>();
  private tracers: Tracer[] = [];
  private tracerGfx!: Phaser.GameObjects.Graphics;
  private zoneGfx!: Phaser.GameObjects.Graphics;
  private currentZoom = 1;
  private fpsTimer = 0;
  private lastStepPos = { x: 0, y: 0 };
  private stepDistance = 0;

  constructor(private readonly session: GameSession) {
    super({ key: 'game' });
  }

  create() {
    makeWorldTextures(this);
    const map = this.session.map;
    this.cameras.main.setBackgroundColor('#2c6a66');

    // the island sits in a jade river with an alluvial bank
    const shore = this.add.graphics().setDepth(-1);
    shore.fillStyle(0x3f8a7e, 1);
    shore.fillRoundedRect(-150, -150, MAP_SIZE + 300, MAP_SIZE + 300, 160);
    shore.fillStyle(0xd2b077, 1);
    shore.fillRoundedRect(-80, -80, MAP_SIZE + 160, MAP_SIZE + 160, 90);
    shore.fillStyle(0xb89458, 0.6);
    shore.fillRoundedRect(-30, -30, MAP_SIZE + 60, MAP_SIZE + 60, 60);

    this.add.tileSprite(0, 0, MAP_SIZE, MAP_SIZE, TEX.grass).setOrigin(0, 0).setDepth(0);

    const decor = this.add.graphics().setDepth(1);
    for (const d of map.decor) {
      decor.fillStyle(d.color, 0.45);
      decor.fillCircle(d.x, d.y, d.r);
    }
    decor.lineStyle(8, 0x5f6a2c, 1);
    decor.strokeRect(0, 0, MAP_SIZE, MAP_SIZE);

    for (const h of map.houses) {
      this.add.tileSprite(h.x + h.w / 2, h.y + h.h / 2, h.w, h.h, TEX.slats).setTint(h.floor).setDepth(2);
    }

    const solid = this.add.graphics().setDepth(5);
    for (const w of map.walls) {
      if (w.houseId >= 0) {
        solid.fillStyle(BAMBOO_WALL, 1);
        solid.fillRect(w.x, w.y, w.w, w.h);
        solid.lineStyle(3, BAMBOO_WALL_EDGE, 1);
        solid.strokeRect(w.x, w.y, w.w, w.h);
        continue;
      }
      // free-standing walls become palisades of sharpened stakes
      const vertical = w.h > w.w;
      const thick = vertical ? w.w : w.h;
      solid.fillStyle(OUTLINE, 0.2);
      solid.fillRect(w.x + 4, w.y + 5, w.w, w.h);
      const stakes = this.add.tileSprite(w.x + w.w / 2, w.y + w.h / 2, vertical ? w.h : w.w, thick, TEX.stakes).setTileScale(thick / 32).setDepth(5);
      if (vertical) stakes.setAngle(90);
    }
    for (const r of map.rocks) {
      const jar = r.r <= JAR_MAX_RADIUS;
      const tex = jar ? TEX.jar : r.id % 2 ? TEX.boulder : TEX.boulder2;
      const size = (r.r * 128) / PROP_RADIUS;
      this.add.image(r.x, r.y, tex).setDisplaySize(size, size).setDepth(5);
    }
    for (const t of map.trees) {
      const kind = TREE_KINDS[t.id % TREE_KINDS.length];
      const trunk = kind === 'bamboo' ? TEX.trunkBamboo : kind === 'banana' ? TEX.trunkBanana : TEX.trunkAreca;
      const trunkSize = (t.r * 64) / TRUNK_RADIUS;
      this.add.image(t.x, t.y, trunk).setDisplaySize(trunkSize, trunkSize).setRotation(t.id).setDepth(5);
      const canopyR = t.r * 2.4;
      const img = this.add.image(t.x, t.y, TEX[kind]).setDisplaySize(canopyR * 2, canopyR * 2).setDepth(20);
      img.rotation = (t.id * 1.7) % (Math.PI * 2);
      this.canopies.push({ img, x: t.x, y: t.y, r: canopyR });
    }

    const ladders = this.add.graphics().setDepth(2.5);
    for (const d of map.doors) {
      const rect = this.add.rectangle(d.x + d.w / 2, d.y + d.h / 2, d.w, d.h, DOOR_WOOD).setStrokeStyle(3, DOOR_FRAME).setDepth(4);
      this.doorViews.set(d.id, rect);
      const out = doorOutward(map, d);
      if (out) drawLadder(ladders, d, out.dx, out.dy);
    }

    const chestSize = (CHEST_SIZE * 64) / CHEST_BODY;
    for (const c of map.chests) {
      if (!this.session.world.chestAlive[c.id]) continue;
      this.chestViews.set(c.id, this.add.image(c.x, c.y, TEX.chest).setDisplaySize(chestSize, chestSize).setDepth(5));
    }

    for (const room of map.rooms) this.roofs.set(room.id, this.buildRoof(room));
    // roofs overhang the walls and would hide every door, so each roof repeats the doors along its edge
    const half = WALL_THICKNESS / 2;
    for (const d of map.doors) {
      const cx = d.x + d.w / 2;
      const cy = d.y + d.h / 2;
      const marks: Phaser.GameObjects.Rectangle[] = [];
      for (const id of map.houses[d.houseId].roomIds) {
        const r = map.rooms[id];
        if (cx < r.x - half || cx > r.x + r.w + half || cy < r.y - half || cy > r.y + r.h + half) continue;
        const mark = this.add.rectangle(cx, cy, d.w, d.h, DOOR_WOOD).setStrokeStyle(3, DOOR_FRAME);
        this.roofs.get(id)!.add(mark);
        marks.push(mark);
      }
      this.doorMarks.set(d.id, marks);
      this.setDoor(d.id, this.session.world.doorOpen[d.id]);
    }

    this.tracerGfx = this.add.graphics().setDepth(12);
    this.zoneGfx = this.add.graphics().setDepth(50);

    this.scale.on('resize', (size: Phaser.Structs.Size) => {
      this.cameras.main.setSize(size.width, size.height);
      this.updateZoom(0, true);
    });
    this.updateZoom(0, true);
    startAmbient();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, stopAmbient);
    this.events.once(Phaser.Scenes.Events.DESTROY, stopAmbient);
    this.session.onSceneReady(this);
  }

  /** Thatched boat roof of one room: tiered straw, a shaded far slope, the ridge, and crossed gable horns at the house ends. */
  private buildRoof(room: Room): Phaser.GameObjects.Container {
    const map = this.session.map;
    const house = map.houses[room.houseId];
    const half = WALL_THICKNESS / 2;
    const x = room.x - half;
    const y = room.y - half;
    const w = room.w + WALL_THICKNESS;
    const h = room.h + WALL_THICKNESS;
    // one ridge direction per house, so neighbouring rooms line up into a single long roof
    const alongX = house.w >= house.h;
    const thatch = alongX
      ? this.add.tileSprite(x + w / 2, y + h / 2, w, h, TEX.thatch)
      : this.add.tileSprite(x + w / 2, y + h / 2, h, w, TEX.thatch).setAngle(90);
    thatch.setTint(house.roof);

    const g = this.add.graphics();
    g.fillStyle(0x3a2410, 0.16);
    if (alongX) g.fillRect(x, y + h / 2, w, h / 2);
    else g.fillRect(x + w / 2, y, w / 2, h);
    g.lineStyle(4, 0x4a3216, 0.85);
    g.strokeRect(x, y, w, h);
    const ridge = alongX ? [x + 4, y + h / 2, x + w - 4, y + h / 2] : [x + w / 2, y + 4, x + w / 2, y + h - 4];
    g.lineStyle(9, DARK_WOOD, 1);
    g.lineBetween(ridge[0], ridge[1], ridge[2], ridge[3]);
    g.lineStyle(2.5, 0xe8cf8a, 0.7);
    g.lineBetween(ridge[0] - (alongX ? 0 : 2), ridge[1] - (alongX ? 2 : 0), ridge[2] - (alongX ? 0 : 2), ridge[3] - (alongX ? 2 : 0));

    const ends = alongX
      ? [
          { at: Math.abs(room.x - (house.x + half)) < 1, x, y: y + h / 2, dx: -1, dy: 0 },
          { at: Math.abs(room.x + room.w - (house.x + house.w - half)) < 1, x: x + w, y: y + h / 2, dx: 1, dy: 0 },
        ]
      : [
          { at: Math.abs(room.y - (house.y + half)) < 1, x: x + w / 2, y, dx: 0, dy: -1 },
          { at: Math.abs(room.y + room.h - (house.y + house.h - half)) < 1, x: x + w / 2, y: y + h, dx: 0, dy: 1 },
        ];
    for (const e of ends) {
      // a doorway at the gable already has a ladder; horns there would hide it
      const blocked = map.doors.some((d) => d.houseId === house.id && Math.hypot(d.x + d.w / 2 - e.x, d.y + d.h / 2 - e.y) < DOOR_WIDTH);
      if (e.at && !blocked) drawGableHorns(g, e.x, e.y, e.dx, e.dy);
    }
    return this.add.container(0, 0, [thatch, g]).setDepth(30);
  }

  setDoor(id: number, open: boolean) {
    const rect = this.doorViews.get(id);
    if (!rect) return;
    rect.setAlpha(open ? 0.25 : 1);
    rect.setFillStyle(open ? 0xf0c890 : DOOR_WOOD);
    for (const mark of this.doorMarks.get(id) ?? []) mark.setFillStyle(open ? DOOR_GAP : DOOR_WOOD);
  }

  removeChest(id: number) {
    const view = this.chestViews.get(id);
    if (!view) return;
    this.chestViews.delete(id);
    this.tweens.add({ targets: view, scale: 1.4, alpha: 0, duration: 250, onComplete: () => view.destroy() });
    this.particles(view.x, view.y, 0xa8732e, 10);
  }

  private updateZoom(delta = 0, force = false) {
    const scope = this.session.viewScope as ScopeLevel;
    const diag = Math.hypot(this.scale.width, this.scale.height);
    const target = diag / (BASE_VIEW_DIAGONAL * (SCOPE_VIEW_MULTIPLIER[scope] ?? 1));
    if (!force && this.currentZoom === target) return;
    if (force || Math.abs(target - this.currentZoom) < target * 0.001) {
      this.currentZoom = target;
    } else {
      // eased in log space so zooming in and out feel equally fast, independent of frame rate
      const k = 1 - Math.exp(-delta / ZOOM_EASE_MS);
      this.currentZoom = Math.exp(Math.log(this.currentZoom) + Math.log(target / this.currentZoom) * k);
    }
    this.cameras.main.setZoom(this.currentZoom);
  }

  // ---------------------------------------------------------------- loot

  addLoot(l: LootNet) {
    const [id, item, x, y, amount] = l;
    this.lootViews.get(id)?.destroy();
    const def = ITEMS[item];
    const rarity = rarityOf(item);
    const color = RARITY_COLOR[rarity];
    const shadow = this.add.ellipse(2, 18, 40, 12, OUTLINE, 0.22);
    const glow = this.add.circle(0, 0, 27, color, 0.3);
    glow.setName('glow');
    const outer = this.add.circle(0, 0, 22.5, OUTLINE);
    const disc = this.add.circle(0, 0, 20, 0xffffff, 0.96).setStrokeStyle(4, color);
    const sheen = this.add.ellipse(-6, -9, 18, 8, 0xffffff, 0.9);
    const parts: Phaser.GameObjects.GameObject[] = [shadow, glow, outer, disc, sheen];
    const key = this.ensureIcon(item);
    const icon = key
      ? this.add.image(0, 0, key).setDisplaySize(34, 34)
      : this.add.text(0, 1, def.icon, { fontSize: '18px' }).setOrigin(0.5);
    icon.setName('icon');
    parts.push(icon);
    const name = this.add
      .text(0, 28, def.kind === 'ammo' ? `${def.name} ×${amount}` : def.name, {
        fontFamily: "'Baloo 2', sans-serif", fontSize: '13px', fontStyle: 'bold', color: '#fff', stroke: '#2a1a0e', strokeThickness: 4,
      })
      .setOrigin(0.5, 0)
      .setVisible(false);
    name.setName('name');
    parts.push(name);
    const cont = this.add.container(x, y, parts).setDepth(3);
    cont.setData('phase', (id * 0.83) % (Math.PI * 2));
    cont.setData('shine', rarity === 'epic' || rarity === 'legendary');
    this.lootViews.set(id, cont);
  }

  private ensureIcon(item: ItemId): string | null {
    const key = iconTextureKey(item);
    if (this.textures.exists(key)) return key;
    const img = iconImages.get(item);
    if (!img || !img.complete || img.naturalWidth === 0) return null;
    this.textures.addImage(key, img);
    return key;
  }

  removeLoot(id: number) {
    this.lootViews.get(id)?.destroy();
    this.lootViews.delete(id);
  }

  // ---------------------------------------------------------------- events

  handleEvent(e: GameEvent, listener: { x: number; y: number }) {
    const at = (x: number, y: number) => spotAt(x - listener.x, y - listener.y);
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
        sfx.shot(e.w, at(e.x, e.y), e.pid === this.session.viewPid);
        if (e.pid === this.session.viewPid && settings.screenShake && (e.w === 'shotgun' || e.w === 'sniper')) {
          this.cameras.main.shake(80, 0.003);
        }
        break;
      }
      case 'bulletEnd': {
        const t = this.tracers.find((tr) => tr.id === e.id);
        if (t) t.maxDist = Math.min(t.maxDist, Math.hypot(e.x - t.x, e.y - t.y));
        this.particles(e.x, e.y, e.blood ? 0xc0392b : 0xcfcfcf, e.blood ? 6 : 3);
        if (e.blood) sfx.hit(at(e.x, e.y));
        break;
      }
      case 'melee': {
        this.players.get(e.pid)?.punch();
        const v = this.players.get(e.pid);
        if (v) sfx.melee(at(v.container.x, v.container.y));
        break;
      }
      case 'boom': {
        const ring = this.add.circle(e.x, e.y, 20, 0xff9a2e, 0.85).setDepth(46);
        this.tweens.add({ targets: ring, radius: 170, alpha: 0, duration: 450, onComplete: () => ring.destroy() });
        this.particles(e.x, e.y, 0x555555, 14, 120);
        sfx.boom(at(e.x, e.y));
        const d = Math.hypot(e.x - listener.x, e.y - listener.y);
        if (settings.screenShake && d < 700) this.cameras.main.shake(300, 0.012 * (1 - d / 700));
        break;
      }
      case 'reload': {
        const v = this.players.get(e.pid);
        if (v) sfx.reload(at(v.container.x, v.container.y));
        break;
      }
      case 'throw': {
        const v = this.players.get(e.pid);
        if (v) sfx.throwItem(at(v.container.x, v.container.y));
        break;
      }
      case 'door': {
        this.setDoor(e.id, e.open);
        const d = this.session.map.doors[e.id];
        sfx.door(at(d.x, d.y));
        break;
      }
      case 'chest': {
        const c = this.chestViews.get(e.id);
        if (c) sfx.chest(at(c.x, c.y));
        this.removeChest(e.id);
        break;
      }
      case 'dmg':
        if (settings.damageNumbers) this.floatText(e.x, e.y - 20, String(e.n), '#ffe066');
        sfx.hitMarker();
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

    this.updateZoom(delta);
    this.cameras.main.centerOn(view.x, view.y);

    const room = roomAt(s.map, view.x, view.y);
    this.footsteps(view.x, view.y, room >= 0);
    for (const [id, roof] of this.roofs) {
      const target = id === room ? 0 : 1;
      roof.alpha += (target - roof.alpha) * Math.min(1, delta / 80);
    }
    for (const c of this.canopies) {
      const under = (c.x - view.x) ** 2 + (c.y - view.y) ** 2 < (c.r * 0.85) ** 2;
      const target = under ? 0.45 : 1;
      c.img.alpha += (target - c.img.alpha) * Math.min(1, delta / 100);
    }

    const cam = this.cameras.main.worldView;
    const t = now / 1000;
    for (const cont of this.lootViews.values()) {
      const near = Math.abs(cont.x - view.x) < 110 && Math.abs(cont.y - view.y) < 110;
      (cont.getByName('name') as Phaser.GameObjects.Text | null)?.setVisible(near);
      if (!cam.contains(cont.x, cont.y)) continue;
      const phase = cont.getData('phase') as number;
      (cont.getByName('icon') as Phaser.GameObjects.Image | null)?.setY(Math.sin(t * 2.4 + phase) * 2);
      const glow = cont.getByName('glow') as Phaser.GameObjects.Arc | null;
      if (glow) glow.setAlpha(cont.getData('shine') ? 0.3 + 0.25 * Math.sin(t * 3 + phase) : 0.3);
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

  private footsteps(x: number, y: number, indoors: boolean) {
    const moved = Math.hypot(x - this.lastStepPos.x, y - this.lastStepPos.y);
    this.lastStepPos = { x, y };
    if (moved > 200) return;
    this.stepDistance += moved;
    if (this.stepDistance < 75) return;
    this.stepDistance = 0;
    sfx.step(indoors ? 'wood' : 'grass');
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
        // a bronze drum carried down by a Lạc bird
        const drum = this.add.image(0, 0, TEX.drum).setDisplaySize(76, 76);
        const bird = this.add.image(0, -24, TEX.lacBird).setDisplaySize(196, 98);
        bird.setName('chute');
        const shadow = this.add.circle(0, 0, 40, 0x000000, 0.25);
        shadow.setName('shadow');
        v = this.add.container(x, y, [shadow, drum, bird]).setDepth(9);
        this.airdropViews.set(id, v);
      }
      const chute = v.getByName('chute') as Phaser.GameObjects.Image;
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