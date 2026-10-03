import Phaser from 'phaser';
import {
  BASE_VIEW_DIAGONAL,
  CHEST_SIZE,
  DOOR_WIDTH,
  ITEMS,
  MAP_DEFS,
  PLAYER_RADIUS,
  SCOPE_VIEW_MULTIPLIER,
  WALL_THICKNESS,
  WEAPONS,
  angleDiff,
  doorOutward,
  muzzleDistance,
  roomAt,
  PFLAG_DISCONNECTED,
  PFLAG_HEALING,
  BOAR_RADIUS,
  FIRING_LINE_X,
  LANE_Y0,
  LANE_Y1,
  RACK_ITEMS,
  RACK_STEP,
  RACK_X,
  RACK_Y0,
  RANGE_BOUNDS,
  TRAINING_LANES,
  TRAINING_MAP,
  laneX,
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
import { OWN_MARKER_COLOR, cssToNumber } from './team';
import { BOAR_BODY, CHEST_BODY, HELD_H, HELD_W, PROP_RADIUS, TEX, TRUNK_RADIUS, makeWorldTextures, tileScale, worldResolution } from './worldArt';

/** Rattan, buffalo hide and Đông Sơn bronze. */
const ARMOR_COLORS = [0, 0xdcb878, 0x9a6234, 0xe3ac30];
/** Gùi baskets from plain bamboo to the dark patterned one. */
const BAG_COLORS = [0, 0xe3b56e, 0xb8793a, 0x8a4a22];

/** Texture and hand positions (relative to the player's centre, facing +x) of each ranged weapon. */
const HOLD: Partial<Record<WeaponId, { tex: string; hands: [number, number, number, number] }>> = {
  pistol: { tex: TEX.heldBlowpipe, hands: [24, -4, 36, 4] },
  rifle: { tex: TEX.heldBow, hands: [36, -2, 17, 3] },
  shotgun: { tex: TEX.heldCrossbow, hands: [38, -5, 21, 5] },
  sniper: { tex: TEX.heldDivineBow, hands: [44, -2, 19, 3] },
};

/** How each projectile looks in flight: shaft length, thickness and colours. */
const PROJECTILE: Partial<Record<WeaponId, { len: number; w: number; shaft: number; head: number; fletch: number; trail: number }>> = {
  pistol: { len: 12, w: 1.6, shaft: 0xe8cf8a, head: 0x8a96a3, fletch: 0xfffaf0, trail: 0xfff6dc },
  rifle: { len: 26, w: 2.4, shaft: 0xc89a5a, head: 0xc8963e, fletch: 0xf2e6cc, trail: 0xfff1c8 },
  shotgun: { len: 16, w: 2.2, shaft: 0x8a5a2b, head: 0xd4a02a, fletch: 0xf2e6cc, trail: 0xfff1c8 },
  sniper: { len: 34, w: 3, shaft: 0xffd34a, head: 0xffc21a, fletch: 0xff5a4a, trail: 0xffe27a },
};

const ZOOM_EASE_MS = 90;
const DOOR_WOOD = 0xc77a3a;
const DOOR_FRAME = 0x5a3010;
const DOOR_GAP = 0x3b2410;
const SKIN = 0xf0c08a;
const HAND_X = 14;
const HAND_Y = 16;
const PUNCH_MS = 160;
const SLASH_MS = 320;
const KNIFE_GRIP = Math.atan2(HAND_Y, HAND_X);
const KNIFE_REACH = Math.hypot(HAND_X, HAND_Y);

const OUTLINE = 0x2a1a0e;
const BAMBOO_WALL = 0xb98d52;
const BAMBOO_WALL_EDGE = 0x5c3a1a;
const DARK_WOOD = 0x5a3a18;
/** Tree kinds by id, roughly 4 bamboo : 3 areca : 3 banana. */
const TREE_KINDS = ['bamboo', 'bamboo', 'areca', 'banana', 'areca', 'bamboo', 'banana', 'areca', 'bamboo', 'banana'] as const;
/** Small rocks read better as clay jars; big ones stay limestone boulders. */
const JAR_MAX_RADIUS = 42;
/** World width of the boar's body; its hit circle is a bit wider so shots on the flank count. */
const BOAR_WIDTH = BOAR_RADIUS * 1.3;
const BOAR_BAR_W = 46;

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

/** An arrow, bolt or dart flying from the shooter's weapon tip (as drawn) to where the shot really stops. */
interface Tracer {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  speed: number;
  len: number;
  born: number;
  w: WeaponId;
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
  private readonly held: Phaser.GameObjects.Image;
  private readonly healRing: Phaser.GameObjects.Arc;
  private weapon: WeaponId | null = null;
  private armor: ArmorLevel = 0;
  private bagLevel: BagLevel = 0;
  lastSeen = 0;
  private punching = 0;
  private punchMs = PUNCH_MS;
  private punchLeft = true;

  constructor(scene: Phaser.Scene, readonly pid: number, name: string | null, isSelf: boolean, textResolution: number, mateColor: string | null = null, admin = false) {
    this.bag = scene.add.circle(-16, 0, 13, 0x000000).setVisible(false);
    this.gun = scene.add.rectangle(30, 0, 40, 7, 0x333333).setOrigin(0, 0.5).setStrokeStyle(2, OUTLINE);
    this.held = scene.add.image(0, 0, TEX.heldBow).setOrigin(0, 0.5).setDisplaySize(HELD_W, HELD_H).setVisible(false);
    this.handL = scene.add.circle(14, -16, 7, SKIN).setStrokeStyle(2.5, OUTLINE);
    this.handR = scene.add.circle(14, 16, 7, SKIN).setStrokeStyle(2.5, OUTLINE);
    const ring = isSelf ? 0xffc21a : mateColor ? cssToNumber(mateColor) : OUTLINE;
    this.body = scene.add.circle(0, 0, PLAYER_RADIUS, SKIN).setStrokeStyle(isSelf || mateColor ? 4 : 3, ring);
    this.armorRing = scene.add.circle(0, 0, PLAYER_RADIUS - 5).setStrokeStyle(5, 0x000000).setVisible(false);
    this.healRing = scene.add.circle(0, 0, PLAYER_RADIUS + 6).setStrokeStyle(3, 0x5cff7a, 0.8).setVisible(false);
    // Đông Sơn feather headdress fanning out behind the head; it also shows which way the player faces
    const plume = scene.add.image(-PLAYER_RADIUS + 8, 0, TEX.plume).setOrigin(1, 0.5).setDisplaySize(30, 30);
    this.container = scene.add.container(0, 0, [plume, this.bag, this.gun, this.held, this.handL, this.handR, this.body, this.armorRing, this.healRing]);
    this.container.setDepth(10);
    this.label = name
      ? scene.add
          .text(0, 0, admin ? `★ ${name} ★` : name, {
            fontFamily: "'Baloo 2', sans-serif", fontSize: admin ? '16px' : '15px', fontStyle: 'bold',
            color: isSelf ? '#ffe066' : (mateColor ?? (admin ? '#ffc23d' : '#ffffff')),
            stroke: admin ? '#5c1504' : '#2a1a0e', strokeThickness: 4, resolution: textResolution,
          })
          .setOrigin(0.5, 1)
          .setDepth(60)
      : null;
    if (admin) this.label?.setShadow(0, 0, '#ff8a1f', 8, true, false);
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
      const t = 1 - this.punching / this.punchMs;
      if (weapon === 'fists') this.animatePunch(t);
      else if (weapon === 'knife') this.animateSlash(t);
    }
  }

  /** Jab with one hand; hands alternate between punches. */
  private animatePunch(t: number) {
    const k = Math.sin(t * Math.PI);
    const side = this.punchLeft ? -1 : 1;
    const hand = this.punchLeft ? this.handL : this.handR;
    hand.setPosition(HAND_X + k * 18, side * HAND_Y * (1 - 0.5 * k));
  }

  /** Fan the knife across the front (right → left → right) along an arc around the body. */
  private animateSlash(t: number) {
    const k = Math.sin(t * Math.PI);
    const a = KNIFE_GRIP * Math.cos(t * Math.PI * 2);
    const r = KNIFE_REACH + 6 * k;
    const hx = Math.cos(a) * r;
    const hy = Math.sin(a) * r;
    const blade = a * Math.min(1, k * 3);
    this.handR.setPosition(hx, hy);
    this.gun.setPosition(hx + Math.cos(blade) * 4, hy + Math.sin(blade) * 4).setRotation(blade);
    this.handL.setPosition(HAND_X - 8 * k, -HAND_Y - 3 * k);
  }

  private setWeapon(w: WeaponId) {
    this.weapon = w;
    const def = WEAPONS[w];
    this.gun.setRotation(0);
    const hold = HOLD[w];
    this.held.setVisible(!!hold);
    if (hold) {
      this.gun.setVisible(false);
      this.held.setTexture(hold.tex).setDisplaySize(HELD_W, HELD_H);
      const [lx, ly, rx, ry] = hold.hands;
      this.handL.setPosition(lx, ly);
      this.handR.setPosition(rx, ry);
      return;
    }
    this.handL.setPosition(HAND_X, -HAND_Y);
    this.handR.setPosition(HAND_X, HAND_Y);
    if (w === 'knife') {
      this.gun.setVisible(true).setPosition(HAND_X + 4, HAND_Y).setSize(22, 4).setFillStyle(def.color);
    } else {
      this.gun.setVisible(false);
    }
  }

  punch() {
    if (this.weapon === 'fists') {
      this.handL.setPosition(HAND_X, -HAND_Y);
      this.handR.setPosition(HAND_X, HAND_Y);
      this.punchLeft = !this.punchLeft;
    }
    this.punchMs = this.weapon === 'knife' ? SLASH_MS : PUNCH_MS;
    this.punching = this.punchMs;
  }

  /** Muzzle of the gun `w` as this player is currently drawn; `maxDist` keeps it from poking past a wall. */
  muzzle(w: WeaponId, maxDist = Infinity): { x: number; y: number } {
    const len = Math.min(muzzleDistance(w) || PLAYER_RADIUS, maxDist);
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
  private cullables: { obj: Phaser.GameObjects.Graphics | Phaser.GameObjects.Container; x0: number; y0: number; x1: number; y1: number }[] = [];
  private doorMarks = new Map<number, Phaser.GameObjects.Rectangle[]>();
  private canopies: { img: Phaser.GameObjects.Image; x: number; y: number; r: number }[] = [];
  private throwViews = new Map<number, Phaser.GameObjects.Image>();
  private smokeViews = new Map<number, Phaser.GameObjects.Arc>();
  private airdropViews = new Map<number, Phaser.GameObjects.Container>();
  private boarViews = new Map<number, { cont: Phaser.GameObjects.Container; body: Phaser.GameObjects.Image; bar: Phaser.GameObjects.Rectangle; facing: number }>();
  private readonly training: boolean;
  private tracers: Tracer[] = [];
  private tracerGfx!: Phaser.GameObjects.Graphics;
  private zoneGfx!: Phaser.GameObjects.Graphics;
  private markerGfx!: Phaser.GameObjects.Graphics;
  private currentZoom = 1;
  private textResolution = 1;
  private fpsTimer = 0;
  private lastStepPos = { x: 0, y: 0 };
  private stepDistance = 0;

  constructor(private readonly session: GameSession) {
    super({ key: 'game' });
    this.training = session.map.id === TRAINING_MAP;
  }

  create() {
    makeWorldTextures(this);
    this.textResolution = worldResolution(this);
    const map = this.session.map;
    this.cameras.main.setBackgroundColor('#2c6a66');

    // the island sits in a jade river with an alluvial bank
    const shore = this.add.graphics().setDepth(-1);
    shore.fillStyle(0x3f8a7e, 1);
    shore.fillRoundedRect(-150, -150, map.size + 300, map.size + 300, 160);
    shore.fillStyle(0xd2b077, 1);
    shore.fillRoundedRect(-80, -80, map.size + 160, map.size + 160, 90);
    shore.fillStyle(0xb89458, 0.6);
    shore.fillRoundedRect(-30, -30, map.size + 60, map.size + 60, 60);

    this.add.tileSprite(0, 0, map.size, map.size, TEX.grass).setOrigin(0, 0).setTileScale(tileScale(this, TEX.grass))
      .setTint(MAP_DEFS[map.id].theme.grassTint).setDepth(0);

    // Phaser re-tessellates every Graphics each frame, so static vector art is split per object and culled offscreen
    for (const d of map.decor) {
      const g = this.add.graphics().setDepth(1);
      g.fillStyle(d.color, 0.45);
      g.fillCircle(d.x, d.y, d.r);
      this.cull(g, d.x - d.r, d.y - d.r, d.x + d.r, d.y + d.r);
    }
    const border = this.add.graphics().setDepth(1);
    border.lineStyle(8, 0x5f6a2c, 1);
    border.strokeRect(0, 0, map.size, map.size);

    for (const h of map.houses) {
      this.add.tileSprite(h.x + h.w / 2, h.y + h.h / 2, h.w, h.h, TEX.slats).setTileScale(tileScale(this, TEX.slats)).setTint(h.floor).setDepth(2);
    }

    for (const h of map.houses) {
      const g = this.add.graphics().setDepth(5);
      for (const w of map.walls) {
        if (w.houseId !== h.id) continue;
        g.fillStyle(BAMBOO_WALL, 1);
        g.fillRect(w.x, w.y, w.w, w.h);
        g.lineStyle(3, BAMBOO_WALL_EDGE, 1);
        g.strokeRect(w.x, w.y, w.w, w.h);
      }
      const m = WALL_THICKNESS + 4;
      this.cull(g, h.x - m, h.y - m, h.x + h.w + m, h.y + h.h + m);
    }
    const palisadeShadows = this.add.graphics().setDepth(5);
    for (const w of map.walls) {
      if (w.houseId >= 0) continue;
      palisadeShadows.fillStyle(OUTLINE, 0.2);
      palisadeShadows.fillRect(w.x + 4, w.y + 5, w.w, w.h);
    }
    // free-standing walls become palisades of sharpened stakes
    for (const w of map.walls) {
      if (w.houseId >= 0) continue;
      const vertical = w.h > w.w;
      const thick = vertical ? w.w : w.h;
      const stakes = this.add.tileSprite(w.x + w.w / 2, w.y + w.h / 2, vertical ? w.h : w.w, thick, TEX.stakes).setTileScale(tileScale(this, TEX.stakes, thick)).setDepth(5);
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

    const ladders = map.houses.map((h) => {
      const g = this.add.graphics().setDepth(2.5);
      const m = WALL_THICKNESS + 64;
      this.cull(g, h.x - m, h.y - m, h.x + h.w + m, h.y + h.h + m);
      return g;
    });
    for (const d of map.doors) {
      const rect = this.add.rectangle(d.x + d.w / 2, d.y + d.h / 2, d.w, d.h, DOOR_WOOD).setStrokeStyle(3, DOOR_FRAME).setDepth(4);
      this.doorViews.set(d.id, rect);
      const out = doorOutward(map, d);
      if (out) drawLadder(ladders[d.houseId], d, out.dx, out.dy);
    }

    const chestSize = (CHEST_SIZE * 64) / CHEST_BODY;
    for (const c of map.chests) {
      if (!this.session.world.chestAlive[c.id]) continue;
      this.chestViews.set(c.id, this.add.image(c.x, c.y, TEX.chest).setDisplaySize(chestSize, chestSize).setDepth(5));
    }

    for (const room of map.rooms) {
      const roof = this.buildRoof(room);
      this.roofs.set(room.id, roof);
      // gable horns reach about 30px past the eaves
      const m = WALL_THICKNESS + 32;
      this.cull(roof, room.x - m, room.y - m, room.x + room.w + m, room.y + room.h + m);
    }
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

    if (this.training) this.buildRange();
    this.tracerGfx = this.add.graphics().setDepth(12);
    this.zoneGfx = this.add.graphics().setDepth(50);
    this.markerGfx = this.add.graphics().setDepth(55);

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

  /** Chalk firing line, wooden weapon rack and a distance board at both ends of every lane. */
  private buildRange() {
    const { y0, y1 } = RANGE_BOUNDS;
    // the range hugs the west edge of the map, so the camera stops at the edge instead of centring on the sea
    this.cameras.main.setBounds(0, 0, this.session.map.size, this.session.map.size);
    const g = this.add.graphics().setDepth(1.5);
    g.fillStyle(0xd8c08a, 0.5);
    g.fillRect(FIRING_LINE_X - 34, y0 + 20, 68, y1 - y0 - 40);
    g.fillStyle(0xa07a4a, 0.35);
    for (const lane of TRAINING_LANES) g.fillRoundedRect(laneX(lane) - 40, LANE_Y0 - 34, 80, LANE_Y1 - LANE_Y0 + 68, 34);
    g.fillStyle(0xf4ecd2, 0.85);
    for (let y = y0 + 40; y < y1 - 40; y += 36) g.fillRect(FIRING_LINE_X - 3, y, 6, 22);
    g.lineStyle(2, 0xf4ecd2, 0.35);
    for (const lane of TRAINING_LANES) {
      const x = laneX(lane);
      g.lineBetween(x, LANE_Y0 - 20, x, LANE_Y1 + 20);
    }
    const rackTop = RACK_Y0 - 50;
    const rackBottom = RACK_Y0 + (RACK_ITEMS.length - 1) * RACK_STEP + 50;
    g.fillStyle(DARK_WOOD, 0.35);
    g.fillRoundedRect(RACK_X - 44, rackTop, 88, rackBottom - rackTop, 10);
    g.lineStyle(5, DARK_WOOD, 1);
    g.lineBetween(RACK_X - 44, rackTop, RACK_X - 44, rackBottom);
    g.lineBetween(RACK_X + 44, rackTop, RACK_X + 44, rackBottom);
    for (let i = 0; i < RACK_ITEMS.length; i++) {
      const y = RACK_Y0 + i * RACK_STEP + RACK_STEP / 2;
      if (i < RACK_ITEMS.length - 1) g.lineBetween(RACK_X - 44, y, RACK_X + 44, y);
    }
    const style = {
      fontFamily: "'Baloo 2', sans-serif", fontSize: '26px', fontStyle: 'bold', color: '#fff4dc',
      stroke: '#3a200c', strokeThickness: 6, resolution: this.textResolution,
    };
    const board = (x: number, y: number, text: string) => {
      g.fillStyle(0x8a5a2a, 1);
      g.fillRect(x - 4, y + 14, 8, 26);
      g.fillStyle(0xb5844a, 1);
      g.fillRoundedRect(x - 42, y - 20, 84, 40, 8);
      g.lineStyle(3, DARK_WOOD, 1);
      g.strokeRoundedRect(x - 42, y - 20, 84, 40, 8);
      this.add.text(x, y, text, style).setOrigin(0.5).setDepth(1.6);
    };
    for (const lane of TRAINING_LANES) {
      const x = laneX(lane);
      board(x, LANE_Y0 - 50, String(lane.distance));
      board(x, LANE_Y1 + 50, String(lane.distance));
    }
    this.add.text(FIRING_LINE_X, y0 + 100, 'VẠCH BẮN', style).setOrigin(0.5).setDepth(1.6);
    this.add.text(RACK_X, rackTop - 26, 'GIÁ VŨ KHÍ', { ...style, fontSize: '20px' }).setOrigin(0.5).setDepth(1.6);
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
    thatch.setTileScale(tileScale(this, TEX.thatch)).setTint(house.roof);

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

  private cull(obj: Phaser.GameObjects.Graphics | Phaser.GameObjects.Container, x0: number, y0: number, x1: number, y1: number) {
    this.cullables.push({ obj, x0, y0, x1, y1 });
  }

  /** Hides culled objects outside the view; the margin covers camera shake. */
  private applyCulling(cx: number, cy: number) {
    const cam = this.cameras.main;
    const hw = cam.width / cam.zoom / 2 + 64;
    const hh = cam.height / cam.zoom / 2 + 64;
    if (cam.useBounds) {
      // a bounded camera stops short of the player near the edges, so cull around where it really looks
      const b = cam.getBounds();
      cx = hw * 2 >= b.width ? b.centerX : Phaser.Math.Clamp(cx, b.x + hw - 64, b.right - hw + 64);
      cy = hh * 2 >= b.height ? b.centerY : Phaser.Math.Clamp(cy, b.y + hh - 64, b.bottom - hh + 64);
    }
    const x0 = cx - hw;
    const x1 = cx + hw;
    const y0 = cy - hh;
    const y1 = cy + hh;
    for (const c of this.cullables) {
      const visible = c.x1 > x0 && c.x0 < x1 && c.y1 > y0 && c.y0 < y1;
      if (c.obj.visible !== visible) c.obj.setVisible(visible);
    }
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
    // bright backing shown while the item is within pickup reach
    const reach = this.add.circle(0, 0, 32, 0xffdf4d, 0.9).setStrokeStyle(4, 0xffffff, 1).setVisible(false);
    reach.setName('reach');
    const glow = this.add.circle(0, 0, 27, color, 0.3);
    glow.setName('glow');
    const outer = this.add.circle(0, 0, 22.5, OUTLINE);
    const disc = this.add.circle(0, 0, 20, 0xffffff, 0.96).setStrokeStyle(4, color);
    const sheen = this.add.ellipse(-6, -9, 18, 8, 0xffffff, 0.9);
    const parts: Phaser.GameObjects.GameObject[] = [shadow, reach, glow, outer, disc, sheen];
    const key = this.ensureIcon(item);
    const icon = key
      ? this.add.image(0, 0, key).setDisplaySize(34, 34)
      : this.add.text(0, 1, def.icon, { fontSize: '18px', resolution: this.textResolution }).setOrigin(0.5);
    icon.setName('icon');
    parts.push(icon);
    const name = this.add
      .text(0, 28, def.kind === 'ammo' ? `${def.name} ×${amount}` : def.name, {
        fontFamily: "'Baloo 2', sans-serif", fontSize: '13px', fontStyle: 'bold', color: '#fff', stroke: '#2a1a0e', strokeThickness: 4,
        resolution: this.textResolution,
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
        // the server sweeps bullets from the shooter's centre (so a barrel poking through a wall can't shoot past it);
        // the streak is drawn from the muzzle of the shooter as rendered to the bullet's real stopping point
        const dx = Math.cos(e.a);
        const dy = Math.sin(e.a);
        const hit = this.session.world.raycast(e.x, e.y, e.x + dx * e.rng, e.y + dy * e.rng);
        const maxDist = hit ? hit.t * e.rng : e.rng;
        const view = this.players.get(e.pid);
        const reach = Math.min(muzzleDistance(e.w), maxDist);
        const origin = view ? view.muzzle(e.w, maxDist) : { x: e.x + dx * reach, y: e.y + dy * reach };
        const endX = e.x + dx * maxDist;
        const endY = e.y + dy * maxDist;
        const len = Math.hypot(endX - origin.x, endY - origin.y);
        if (maxDist > muzzleDistance(e.w) && len > 1) {
          this.tracers.push({
            id: e.id, x: origin.x, y: origin.y, dx: (endX - origin.x) / len, dy: (endY - origin.y) / len,
            speed: e.spd, len, born: performance.now(), w: e.w,
          });
        }
        this.release(origin.x, origin.y, e.w);
        sfx.shot(e.w, at(e.x, e.y), e.pid === this.session.viewPid);
        if (e.pid === this.session.viewPid && settings.screenShake && (e.w === 'shotgun' || e.w === 'sniper')) {
          this.cameras.main.shake(80, 0.003);
        }
        break;
      }
      case 'bulletEnd': {
        const t = this.tracers.find((tr) => tr.id === e.id);
        if (t) t.len = Math.min(t.len, Math.hypot(e.x - t.x, e.y - t.y));
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
      case 'boarDown':
        this.particles(e.x, e.y, 0xc0392b, 14, 50);
        this.particles(e.x, e.y, 0x6b4a2e, 8, 40);
        this.floatText(e.x, e.y - 44, `Hạ! ${e.d}`, '#ff9a4a');
        break;
      default:
        break;
    }
  }

  /** A puff of breath from the blowpipe, a flick of dust off a bowstring, a golden glint from the Thần tiễn. */
  private release(x: number, y: number, w: WeaponId) {
    const look = w === 'sniper' ? { r: 8, color: 0xffe27a, alpha: 0.8 } : w === 'pistol' ? { r: 6, color: 0xffffff, alpha: 0.55 } : { r: 5, color: 0xf2e6cc, alpha: 0.5 };
    const f = this.add.circle(x, y, look.r, look.color, look.alpha).setDepth(13);
    this.tweens.add({ targets: f, alpha: 0, scale: w === 'sniper' ? 1.8 : 1.4, duration: w === 'sniper' ? 180 : 110, onComplete: () => f.destroy() });
  }

  private particles(x: number, y: number, color: number, n: number, spread = 30) {
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
      .text(x + (Math.random() - 0.5) * 20, y, text, { fontFamily: "'Baloo 2', sans-serif", fontSize: '22px', fontStyle: 'bold', color, stroke: '#7a3800', strokeThickness: 5, resolution: this.textResolution })
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
        v = new PlayerView(this, p.pid, isSelf ? null : s.nameOf(p.pid), isSelf, this.textResolution, s.mates.get(p.pid) ?? null, s.isAdmin(p.pid));
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
    this.applyCulling(view.x, view.y);

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
    const reachable = new Set(s.lootInReach().map((l) => l[0]));
    for (const [id, cont] of this.lootViews) {
      const near = Math.abs(cont.x - view.x) < 110 && Math.abs(cont.y - view.y) < 110;
      (cont.getByName('name') as Phaser.GameObjects.Text | null)?.setVisible(near);
      const reach = cont.getByName('reach') as Phaser.GameObjects.Arc;
      reach.setVisible(reachable.has(id));
      if (reach.visible) reach.setScale(1 + 0.07 * Math.sin(t * 6));
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
    if (this.training) this.syncBoars(delta);
    else this.drawZone();
    this.drawMarkers(t);

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
      const look = PROJECTILE[t.w] ?? PROJECTILE.rifle!;
      const traveled = ((now - t.born) / 1000) * t.speed;
      // the shot lingers a frame or two where it stopped so short hits still show
      if (traveled > t.len + t.speed * 0.04) return false;
      const head = Math.min(traveled, t.len);
      const at = (d: number) => ({ x: t.x + t.dx * d, y: t.y + t.dy * d });
      // a faint streak shows the flight line, longer and brighter for the Thần tiễn
      const trail = t.w === 'sniper' ? 160 : 60;
      const s0 = at(Math.max(0, head - trail));
      const s1 = at(Math.max(0, head - look.len));
      g.lineStyle(look.w + (t.w === 'sniper' ? 2 : 0), look.trail, t.w === 'sniper' ? 0.45 : 0.25);
      g.lineBetween(s0.x, s0.y, s1.x, s1.y);
      const tail = at(Math.max(0, head - look.len));
      const tip = at(head);
      g.lineStyle(look.w + 2, OUTLINE, 0.85);
      g.lineBetween(tail.x, tail.y, tip.x, tip.y);
      g.lineStyle(look.w, look.shaft, 1);
      g.lineBetween(tail.x, tail.y, tip.x, tip.y);
      const nx = -t.dy;
      const ny = t.dx;
      const hl = look.w * 2.6;
      const hw = look.w * 1.6;
      g.fillStyle(look.head, 1);
      g.fillTriangle(tip.x + t.dx * hl * 0.6, tip.y + t.dy * hl * 0.6, tip.x - t.dx * hl + nx * hw, tip.y - t.dy * hl + ny * hw, tip.x - t.dx * hl - nx * hw, tip.y - t.dy * hl - ny * hw);
      if (t.w === 'pistol') {
        g.fillStyle(look.fletch, 1);
        g.fillCircle(tail.x, tail.y, 2.6);
      } else {
        g.lineStyle(look.w * 0.9, look.fletch, 1);
        for (const side of [-1, 1]) g.lineBetween(tail.x, tail.y, tail.x - t.dx * hl + nx * hw * side, tail.y - t.dy * hl + ny * hw * side);
      }
      return true;
    });
  }


  private syncThrowables() {
    const seen = new Set<number>();
    const now = performance.now();
    for (const [id, kind, x, y] of this.session.throwables) {
      seen.add(id);
      let v = this.throwViews.get(id);
      if (!v) {
        v = this.add.image(x, y, kind === 0 ? TEX.fireJar : TEX.gourd).setDisplaySize(20, 20).setDepth(13);
        this.throwViews.set(id, v);
      }
      v.x += (x - v.x) * 0.35;
      v.y += (y - v.y) * 0.35;
      v.rotation = now / 120 + id;
      // the burning wick flickers so a lit jar on the ground stands out
      if (kind === 0) v.setTint(Math.floor(now / 140) % 2 ? 0xffffff : 0xffb070);
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
    // the drum "beats": two gold rings keep rolling out from it, so it is seen from far away
    const beat = (this.time.now % 1600) / 1600;
    for (const [id, x, y, landed, msLeft] of this.session.airdrops) {
      seen.add(id);
      let v = this.airdropViews.get(id);
      if (!v) {
        // a bronze drum carried down by a Lạc bird
        const waves: Phaser.GameObjects.Arc[] = [];
        for (let i = 0; i < 2; i++) {
          waves.push(this.add.circle(0, 0, 44).setStrokeStyle(8, 0x2a1a0e, 0.35), this.add.circle(0, 0, 44).setStrokeStyle(4, 0xffd257, 1));
        }
        const drum = this.add.image(0, 0, TEX.drum).setDisplaySize(80, 80);
        const bird = this.add.image(0, -24, TEX.lacBird).setDisplaySize(196, 98);
        bird.setName('chute');
        const shadow = this.add.circle(0, 0, 40, 0x000000, 0.25);
        shadow.setName('shadow');
        v = this.add.container(x, y, [...waves, shadow, drum, bird]).setDepth(9);
        v.setData('waves', waves);
        this.airdropViews.set(id, v);
      }
      (v.getData('waves') as Phaser.GameObjects.Arc[]).forEach((ring, i) => {
        const k = (beat + (i >> 1) * 0.5) % 1;
        ring.setScale(1 + k * 1.5).setAlpha(1 - k);
      });
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

  /**
   * Boars move in straight runs, so they are drawn where the server has them now (latest snapshot pushed on by its speed)
   * rather than 100ms in the past like players; aiming at what is on screen then lines up with the server's hit test.
   */
  private syncBoars(delta: number) {
    const s = this.session;
    const ahead = Phaser.Math.Clamp((s.serverTime() - s.boarsAt) / 1000, 0, 0.25);
    const ease = Math.min(1, delta / 60);
    const now = performance.now();
    const seen = new Set<number>();
    for (const [id, x, y, vy, hp] of s.boars) {
      seen.add(id);
      const ty = Phaser.Math.Clamp(y + vy * ahead, LANE_Y0, LANE_Y1);
      let v = this.boarViews.get(id);
      if (!v) {
        const size = (96 * BOAR_WIDTH) / BOAR_BODY;
        const body = this.add.image(0, 0, TEX.boar).setDisplaySize(size, size);
        const back = this.add.rectangle(0, -BOAR_RADIUS - 14, BOAR_BAR_W + 4, 8, 0x2a1a0e, 0.85);
        const bar = this.add.rectangle(-BOAR_BAR_W / 2, -BOAR_RADIUS - 14, BOAR_BAR_W, 4, 0x6ad04a).setOrigin(0, 0.5);
        const cont = this.add.container(x, ty, [body, back, bar]).setDepth(9);
        cont.setData('back', back);
        v = { cont, body, bar, facing: vy < 0 ? -Math.PI / 2 : Math.PI / 2 };
        this.boarViews.set(id, v);
      }
      v.cont.x = x;
      v.cont.y += (ty - v.cont.y) * ease;
      if (vy !== 0) v.facing = vy < 0 ? -Math.PI / 2 : Math.PI / 2;
      // a trot: the body sways while running and holds still while the boar stops to sniff
      const sway = vy !== 0 ? Math.sin(now / 70 + id) * 0.08 : 0;
      v.body.rotation += (v.facing + sway - v.body.rotation) * Math.min(1, delta / 50);
      const hurt = hp < 100;
      v.bar.setVisible(hurt).setDisplaySize((BOAR_BAR_W * hp) / 100, 4).setFillStyle(hp > 50 ? 0x6ad04a : hp > 25 ? 0xf0c040 : 0xe04a3a);
      (v.cont.getData('back') as Phaser.GameObjects.Rectangle).setVisible(hurt);
    }
    for (const [id, v] of this.boarViews) {
      if (seen.has(id)) continue;
      v.cont.destroy();
      this.boarViews.delete(id);
    }
  }

  private drawZone() {
    const z = this.session.zone;
    const g = this.zoneGfx;
    g.clear();
    if (!z) return;
    const [x, y, r, tx, ty, tr] = z;
    const band = 9000;
    if (this.session.lobby) {
      // the waiting area: a warm boundary, no inner target circle
      g.lineStyle(band, 0x3a1a08, 0.35);
      g.strokeCircle(x, y, r + band / 2);
      g.lineStyle(6, 0xffd36a, 0.95);
      g.strokeCircle(x, y, r);
      return;
    }
    g.lineStyle(band, 0x2a4fd6, 0.28);
    g.strokeCircle(x, y, r + band / 2);
    g.lineStyle(5, 0x8fb8ff, 0.95);
    g.strokeCircle(x, y, Math.max(0, r));
    g.lineStyle(3, 0xffffff, 0.85);
    g.strokeCircle(tx, ty, Math.max(0, tr));
  }

  /** Map markers planted in the world: a banner on a pole with a ring pulsing at its foot. */
  private drawMarkers(t: number) {
    const g = this.markerGfx;
    g.clear();
    const s = this.session;
    if (!s.markers.length) return;
    const cam = this.cameras.main.worldView;
    // scopes widen the view; grow the banner with it so it keeps its size on screen
    const m = SCOPE_VIEW_MULTIPLIER[s.viewScope as ScopeLevel] ?? 1;
    const pulse = (t * 0.8) % 1;
    for (const [pid, x, y] of s.markers) {
      if (!cam.contains(x, y) && !cam.contains(x, y - 80 * m)) continue;
      const color = cssToNumber(pid === s.you ? OWN_MARKER_COLOR : s.mates.get(pid) ?? OWN_MARKER_COLOR);
      g.lineStyle(3 * m, 0xffffff, 0.85 * (1 - pulse));
      g.strokeCircle(x, y, (14 + pulse * 30) * m);
      g.fillStyle(0x1a0d06, 0.35);
      g.fillEllipse(x, y, 30 * m, 14 * m);
      g.lineStyle(3 * m, color, 0.95);
      g.strokeEllipse(x, y, 30 * m, 14 * m);
      g.lineStyle(7 * m, 0x1a0d06, 1);
      g.lineBetween(x, y, x, y - 72 * m);
      g.lineStyle(3.5 * m, 0xf3e3bf, 1);
      g.lineBetween(x, y, x, y - 72 * m);
      // the cloth sways a little
      const sway = Math.sin(t * 3 + pid) * 3 * m;
      g.fillStyle(color, 1);
      g.fillTriangle(x + 2 * m, y - 72 * m, x + 50 * m, y - 58 * m + sway, x + 2 * m, y - 44 * m);
      g.lineStyle(3 * m, 0x1a0d06, 1);
      g.strokeTriangle(x + 2 * m, y - 72 * m, x + 50 * m, y - 58 * m + sway, x + 2 * m, y - 44 * m);
      g.fillStyle(0xffd257, 1);
      g.fillCircle(x, y - 74 * m, 5 * m);
    }
  }

  /** Angle difference helper used to keep remote rotation smooth. */
  static lerpAngle(a: number, b: number, k: number): number {
    return a + angleDiff(a, b) * k;
  }
}