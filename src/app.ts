import type { Socket } from 'socket.io-client';
import {
  AVATARS,
  AVATAR_NAMES,
  BOT_DIFFICULTIES,
  BOT_DIFFICULTY_NAMES,
  DEFAULT_BOT_DIFFICULTY,
  DEFAULT_MAP,
  LEADERBOARD_KINDS,
  LEADERBOARD_NAMES,
  MAP_DEFS,
  MAP_IDS,
  MATCH_HISTORY_KEEP,
  MODE_NAMES,
  NAME_MAX_LENGTH,
  PRESENCE_LABELS,
  NAME_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  QUEUE_NOTICE_AFTER_MS,
  ROOM_NAME_MAX_LENGTH,
  TEAM_SIZES,
  TEAM_SIZE_NAMES,
  TRAINING_LANES,
  generateMap,
  isBotDifficulty,
  isLeaderboardKind,
  isMapChoice,
  isTeamSize,
  isUuid,
  levelFromXp,
  mapCapacity,
  validatePassword,
  validateRoomName,
  validateUsername,
  xpForLevel,
  type AdminAccount,
  type BotDifficulty,
  type GameMode,
  type LeaderboardKind,
  type LiveMatchSummary,
  type MapChoice,
  type MapId,
  type MatchHistoryEntry,
  type MatchStartMsg,
  type PartyInviteMsg,
  type PartyStateMsg,
  type Presence,
  type PublicUser,
  type QueueStatusMsg,
  type RankBoard,
  type RankEntry,
  type RoomMember,
  type RoomStateMsg,
  type RoomSummary,
  type TeamSize,
} from './shared';
import { ApiError, api, getToken, setToken } from './api';
import { setMenuMusic, unlockAudio } from './game/audio';
import { MapRenderer } from './game/Minimap';
import type { GameSession } from './game/session';
import type { TouchControls } from './game/Touch';
import { connectSocket, disconnectSocket } from './net';
import { useTouchControls } from './settings';
import { setDevtoolsAllowed } from './ui/devtoolsGuard';
import { $, confirmDialog, esc, formatDate, formatDuration, html, toast } from './ui/dom';
import { enterFullscreen, leaveFullscreen } from './ui/fullscreen';
import { NetStatus, SERVER_WAKING_TEXT } from './ui/netStatus';
import { cachedQrSvg, isLocalOnly, qrSvg, showQrDialog } from './ui/qr';
import { bindSettings, guidePanel, itemsPanel, keysPanel, settingsPanel } from './ui/panels';
import { walker } from './ui/loader';
import { adminBadge, nameHtml } from './ui/names';
import { showStoryDialog } from './ui/story';
import { MODE_ICONS } from './ui/theme';
import { syncLayouts } from './ui/touchLayout';
import { SocialClient } from './social/SocialClient';
import { SocialPanel } from './social/SocialPanel';

type Screen = 'loading' | 'auth' | 'lobby' | 'queue' | 'room' | 'party' | 'profile' | 'ranks' | 'admin' | 'panel' | 'controls' | 'game' | 'message';
/** Screens on the way into a match, or in one; leaving them for anything else ends fullscreen on phones. */
const PLAY_SCREENS = new Set<Screen>(['queue', 'room', 'party', 'game']);
/** Requests sent by the tap that starts a match (or the wait for one); phones go fullscreen right then. */
const FULLSCREEN_EVENTS = new Set(['queue:join', 'party:queue', 'bot:start', 'training:start', 'room:start']);

const PENDING_ROOM_KEY = 'br2d_pending_room';
const PENDING_PARTY_KEY = 'br2d_pending_party';
const INVITE_SENT_MS = 10_000;
const SOCIAL_HIDDEN_ON = new Set<Screen>(['loading', 'auth', 'controls', 'game', 'message']);
const HISTORY_PAGE_SIZE = 10;
/** Shown under the logo on the sign-in screen and in the lobby. */
const TAGLINE = 'Nghịch cảnh càng lớn, ý chí càng mạnh.';

type PanelNav = 'guide' | 'items' | 'keys' | 'settings';
type NavKey = 'lobby' | 'profile' | 'ranks' | 'admin' | 'controls' | PanelNav;
type NavButton = [nav: NavKey, icon: string, label: string];
/** Every menu screen shows the same toolbar (only the highlight moves), so the header never shifts. */
const NAV_BUTTONS: NavButton[] = [
  ['lobby', '🏠', 'Sảnh'],
  ['ranks', '🏆', 'Xếp hạng'],
  ['guide', '📖', 'Hướng dẫn'],
  ['items', '🎒', 'Vật phẩm'],
  ['keys', '⌨️', 'Phím tắt'],
  ['settings', '⚙️', 'Cài đặt'],
];
/** Touch screens have no keyboard shortcuts to list; the button editor takes that place, as in the pause menu. */
const TOUCH_NAV_BUTTONS: NavButton[] = NAV_BUTTONS.map((b) => (b[0] === 'keys' ? ['controls', '🎛️', 'Chỉnh nút'] : b));
const ADMIN_NAV_BUTTON: NavButton = ['admin', '🛡️', 'Quản trị'];
const PRESENCE_ICONS: Record<Presence, string> = { online: '🟢', in_match: '⚔️', offline: '⚪' };

/** Phaser is most of the bundle, so the game code is a separate chunk: fetched in the background after login, awaited on match start. */
let gameModule: Promise<typeof import('./game/session')> | null = null;
const loadGame = () => {
  gameModule ??= import('./game/session').catch((err) => {
    gameModule = null;
    throw err;
  });
  return gameModule;
};

const MAP_CHOICE_KEY = 'br2d_map';
const MAP_CHOICES: MapChoice[] = ['random', ...MAP_IDS];
const RANDOM_MAP = { icon: '🎲', name: 'Ngẫu nhiên', blurb: 'Hệ thống bốc thăm một bản đồ đủ chỗ cho số người trong trận.' };
const SMALLEST_MAP = Math.min(...MAP_IDS.map((id) => MAP_DEFS[id].maxPlayers));

function savedMapChoice(): MapChoice {
  const v = localStorage.getItem(MAP_CHOICE_KEY);
  return isMapChoice(v) ? v : DEFAULT_MAP;
}

const BOT_DIFFICULTY_KEY = 'br2d_bot_difficulty';
function savedBotDifficulty(): BotDifficulty {
  const v = localStorage.getItem(BOT_DIFFICULTY_KEY);
  return isBotDifficulty(v) ? v : DEFAULT_BOT_DIFFICULTY;
}

const TEAM_SIZE_KEY = 'br2d_team_size';
function savedTeamSize(): TeamSize {
  const v = Number(localStorage.getItem(TEAM_SIZE_KEY));
  return isTeamSize(v) ? v : 1;
}

/** Team size last picked inside a room; new rooms open with it. */
const ROOM_TEAM_KEY = 'br2d_room_team';
function savedRoomTeam(): TeamSize {
  const v = Number(localStorage.getItem(ROOM_TEAM_KEY));
  return isTeamSize(v) ? v : 1;
}

/** Name and visibility used for the last room created, offered again in the create dialog. */
const ROOM_NAME_KEY = 'br2d_room_name';
const ROOM_LISTED_KEY = 'br2d_room_listed';

const LIVE_MODE_ICONS: Record<GameMode, string> = { pvp: '⚔️', bots: '🤖', private: '🏮', training: '🎯' };

const PRESENCE_TEXT = { online: 'Trực tuyến', in_match: 'Đang trong trận', offline: 'Ngoại tuyến' } as const;

const mapInfo = (id: MapChoice) => (id === 'random' ? RANDOM_MAP : MAP_DEFS[id]);

const mapTile = (id: MapChoice, selected: boolean, compact: boolean, disabled: boolean) => {
  const m = mapInfo(id);
  const thumb = id === 'random'
    ? '<div class="map-thumb random">🎲</div>'
    : `<canvas class="map-thumb" width="160" height="160" data-preview="${id}"></canvas>`;
  const cap = id === 'random' ? `${SMALLEST_MAP}–${mapCapacity(id)}` : String(mapCapacity(id));
  return `<button type="button" class="map-tile${compact ? ' compact' : ''}${selected ? ' active' : ''}" data-map="${id}" ${disabled ? 'disabled' : ''} title="${esc(`${m.name} (${cap} người): ${m.blurb}`)}">
    ${thumb}<b>${m.icon} ${esc(m.name)}</b><span class="map-cap">👥 ${cap}${compact ? '' : ' người'}</span>${compact ? '' : `<small>${esc(m.blurb)}</small>`}</button>`;
};

const previews = new Map<MapId, MapRenderer>();
function paintPreviews(root: ParentNode) {
  for (const c of root.querySelectorAll<HTMLCanvasElement>('canvas[data-preview]')) {
    const id = c.dataset.preview as MapId;
    let r = previews.get(id);
    if (!r) {
      r = new MapRenderer(generateMap(id), 320);
      previews.set(id, r);
    }
    r.preview(c);
  }
}

const RANKS_CACHE_MS = 30_000;
const RANK_ICONS: Record<LeaderboardKind, string> = { kills: '⚔️', level: '⭐', survival: '⏱️', kd: '🎯', winrate: '👑' };
/** Tab labels; short enough for five tabs side by side on a phone. */
const RANK_TABS: Record<LeaderboardKind, string> = { kills: 'Hạ gục', level: 'Cấp độ', survival: 'Sống sót', kd: 'K/D', winrate: '% Thắng' };
const RANK_NOTES: Record<LeaderboardKind, string> = {
  kills: 'Tổng số đối thủ đã hạ gục qua mọi trận.',
  level: 'Xếp theo tổng kinh nghiệm tích lũy.',
  survival: 'Thời gian sống trung bình mỗi trận.',
  kd: 'Số hạ gục chia cho số trận không thắng.',
  winrate: 'Tỉ lệ trận về nhất trên tổng số trận.',
};
const RANK_MEDALS = ['🥇', '🥈', '🥉'];

function rankValue(kind: LeaderboardKind, e: RankEntry): [main: string, sub: string] {
  switch (kind) {
    case 'kills': return [e.value.toLocaleString('vi-VN'), 'hạ gục'];
    case 'level': return [`Cấp ${e.level}`, `${e.value.toLocaleString('vi-VN')} XP`];
    case 'survival': return [formatDuration(e.value), 'trung bình'];
    case 'kd': return [e.value.toFixed(2), 'K/D'];
    case 'winrate': return [`${(e.value * 100).toFixed(1)}%`, 'thắng'];
  }
}

function rankRow(kind: LeaderboardKind, e: RankEntry, me: boolean) {
  const [main, sub] = rankValue(kind, e);
  const place = e.rank <= 3 ? `<span class="rank-medal" aria-label="Hạng ${e.rank}">${RANK_MEDALS[e.rank - 1]}</span>` : `#${e.rank}`;
  const info = kind === 'level' ? `${e.matches} trận` : `Cấp ${e.level} · ${e.matches} trận`;
  return `<div class="rank-row${e.rank <= 3 ? ` top top${e.rank}` : ''}${me ? ' me' : ''}">
    <span class="rank-no">${place}</span><span class="rank-avatar" aria-hidden="true">${e.avatar}</span>
    <span class="rank-who"><b>${nameHtml(e.username, e.admin)}</b><small>${info}</small></span>
    <span class="rank-val"><b>${main}</b><small>${sub}</small></span></div>`;
}

function rankEntryHint(kind: LeaderboardKind, board: RankBoard) {
  if (kind === 'kills') return 'Hạ gục đối thủ đầu tiên để có tên trên bảng này.';
  if (kind === 'level') return 'Chơi một trận để có tên trên bảng này.';
  return `Cần chơi ít nhất ${board.minMatches} trận để vào bảng này (bạn đã chơi ${board.myMatches}).`;
}

const avatarPicker = (selected: string) =>
  `<div class="avatar-picker">${AVATARS.map((a) => `<button type="button" data-avatar="${a}" class="${a === selected ? 'active' : ''}" title="${AVATAR_NAMES[a]}" aria-label="${AVATAR_NAMES[a]}">${a}</button>`).join('')}</div>`;

export class App {
  private readonly ui = document.getElementById('ui')!;
  private user: PublicUser | null = null;
  private socket: Socket | null = null;
  private session: GameSession | null = null;
  /** The editor on the button editor page; it shares #touch with the match, so leaving the page closes it. */
  private layoutEditor: TouchControls | null = null;
  /** Which menu page is showing while the screen is 'panel', so the button editor page can return to it. */
  private panelNav: PanelNav = 'settings';
  private ranksKind: LeaderboardKind = 'kills';
  private adminQuery = '';
  private adminSeq = 0;
  private adminAccounts: AdminAccount[] = [];
  private readonly ranksCache = new Map<LeaderboardKind, { at: number; board: RankBoard }>();
  /** The room's QR code dialog; it belongs to the room screen and closes with it. */
  private closeQr: (() => void) | null = null;
  private qrOpening = false;
  /** Bumped whenever a pending game load must be discarded (newer match, logout, replaced session). */
  private gameLoad = 0;
  private screen: Screen = 'loading';
  private queue: QueueStatusMsg | null = null;
  private queueSince = 0;
  private queueTimer = 0;
  private room: RoomStateMsg | null = null;
  /** Lobby room list, null until the server first sends it. */
  private roomList: RoomSummary[] | null = null;
  private watchingRooms = false;
  /** Admins only: matches being played, null until the server first sends them. */
  private liveMatches: LiveMatchSummary[] | null = null;
  private watchingMatches = false;
  private browserTab: 'rooms' | 'live' = 'rooms';
  private party: PartyStateMsg | null = null;
  /** Friends invited to the party recently, so their button shows "Đã mời" for a while. */
  private readonly invitedAt = new Map<string, number>();
  private readonly net = new NetStatus();
  private readonly social = new SocialClient();
  private readonly socialPanel = new SocialPanel(this.social);
  /** Set while a start/join request is in flight so repeated taps don't send it twice. */
  private pendingUntil = 0;

  constructor() {
    this.social.subscribe((c) => {
      if (this.screen === 'party' && (c.type === 'friends' || c.type === 'presence')) this.renderPartyFriends();
    });
  }

  async init() {
    const params = new URLSearchParams(location.search);
    const invite = params.get('room');
    if (invite && isUuid(invite)) sessionStorage.setItem(PENDING_ROOM_KEY, invite);
    const partyInvite = params.get('party');
    if (partyInvite && isUuid(partyInvite)) sessionStorage.setItem(PENDING_PARTY_KEY, partyInvite);
    if (invite || partyInvite) history.replaceState(null, '', location.pathname);

    this.render('loading', `<div class="screen centered"><div><div class="logo">BÁ KHÍ<span>TRỜI NAM 2D</span></div>${walker()}<p class="muted center" id="boot-hint"></p></div></div>`);
    const hintTimer = window.setTimeout(() => {
      const hint = this.ui.querySelector('#boot-hint');
      if (hint) hint.textContent = SERVER_WAKING_TEXT;
    }, 4000);
    if (!getToken()) {
      clearTimeout(hintTimer);
      return this.showAuth('login');
    }
    try {
      const { user } = await api.me();
      this.onLoggedIn(user);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setToken(null);
        this.showAuth('login');
      } else {
        setDevtoolsAllowed(false);
        this.showMessage('Không kết nối được máy chủ', (err as Error).message, () => this.init());
      }
    } finally {
      clearTimeout(hintTimer);
    }
  }

  /** Emits a lobby request only when connected; `once` requests are also debounced until the server answers. */
  private send(event: string, arg?: unknown, once = false): boolean {
    const s = this.socket;
    if (!s?.connected) {
      toast('Chưa kết nối được máy chủ, vui lòng đợi giây lát…', 'error');
      return false;
    }
    if (once) {
      if (Date.now() < this.pendingUntil) return false;
      this.pendingUntil = Date.now() + 5000;
      document.body.classList.add('net-pending');
    }
    // must run inside the tap: the match start that follows comes from the server, too late to count as one
    if (FULLSCREEN_EVENTS.has(event)) void enterFullscreen();
    if (arg === undefined) s.emit(event);
    else s.emit(event, arg);
    return true;
  }

  private clearPending() {
    this.pendingUntil = 0;
    document.body.classList.remove('net-pending');
  }

  private async copyText(text: string, label: string): Promise<boolean> {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        if (!ok) throw new Error('copy failed');
      }
      toast(`Đã sao chép ${label}`);
      return true;
    } catch {
      toast('Trình duyệt không cho phép sao chép, hãy chạm giữ vào mã để chép thủ công.', 'error', 4000);
      return false;
    }
  }

  private loadFailed(title: string, err: unknown, retry: () => void) {
    const nav = this.screen === 'profile' || this.screen === 'ranks' ? this.screen : null;
    this.render(this.screen, `<div class="screen"><div class="container">${this.header(nav)}
      <div class="card center"><h2>${esc(title)}</h2><p class="muted">${esc((err as Error).message)}</p>
      <button class="btn primary" id="retry">Thử lại</button></div></div></div>`);
    this.bindNav();
    $('#retry').addEventListener('click', retry);
  }

  private render(screen: Screen, markup: string) {
    // fullscreen turned on by a play button ends when the player backs out without playing (left the queue or room)
    if (PLAY_SCREENS.has(this.screen) && !PLAY_SCREENS.has(screen)) leaveFullscreen();
    if (screen !== 'controls') this.closeLayoutEditor();
    if (screen !== 'room') this.closeQr?.();
    this.screen = screen;
    this.ui.innerHTML = markup;
    this.ui.classList.toggle('hidden', screen === 'game');
    setMenuMusic(screen !== 'game');
    this.socialPanel.setAllowed(!!this.user && !!this.socket && !SOCIAL_HIDDEN_ON.has(screen));
    this.syncRoomWatch();
  }

  /** The server only pushes the room list (and, to admins, the live match list) while the lobby is on screen. */
  private syncRoomWatch() {
    const s = this.socket;
    if (!s?.connected) {
      this.watchingRooms = false;
      this.watchingMatches = false;
      return;
    }
    const want = this.screen === 'lobby';
    if (want !== this.watchingRooms) {
      this.watchingRooms = want;
      s.emit(want ? 'rooms:watch' : 'rooms:unwatch');
    }
    const wantMatches = want && this.isAdmin;
    if (wantMatches !== this.watchingMatches) {
      this.watchingMatches = wantMatches;
      s.emit(wantMatches ? 'matches:watch' : 'matches:unwatch');
    }
  }

  private get isAdmin(): boolean {
    return this.user?.role === 'admin';
  }

  private showMessage(title: string, text: string, retry?: () => void) {
    this.render('message', `<div class="screen"><div class="narrow" style="margin-top:12vh"><div class="card center">
      <h2>${esc(title)}</h2><p class="muted">${esc(text)}</p>
      ${retry ? '<button class="btn primary" id="retry">Thử lại</button>' : ''}</div></div></div>`);
    if (retry) $('#retry').addEventListener('click', retry);
  }

  // ---------------------------------------------------------------- auth

  private showAuth(tab: 'login' | 'register') {
    setDevtoolsAllowed(false);
    const pendingRoom = sessionStorage.getItem(PENDING_ROOM_KEY);
    const pendingParty = sessionStorage.getItem(PENDING_PARTY_KEY);
    let avatar: string = AVATARS[Math.floor(Math.random() * AVATARS.length)];
    this.render('auth', `
      <div class="screen auth-screen${tab === 'register' ? ' auth-reg' : ''}">
        <div class="logo-kicker">Huyền sử Văn Lang</div>
        <div class="logo">BÁ KHÍ<span>TRỜI NAM 2D</span></div>
        <div class="subtitle">${TAGLINE}</div>
        <div class="narrow">
          ${pendingRoom ? '<div class="notice" style="margin-bottom:12px">Bạn được mời vào một phòng chơi. Hãy đăng nhập hoặc đăng ký để vào phòng.</div>' : ''}
          ${pendingParty && !pendingRoom ? '<div class="notice" style="margin-bottom:12px">Bạn được mời vào một nhóm ghép trận. Hãy đăng nhập hoặc đăng ký để vào nhóm.</div>' : ''}
          <div class="card">
            <div class="tabs">
              <button class="btn ${tab === 'login' ? 'active' : ''}" data-tab="login">Đăng nhập</button>
              <button class="btn ${tab === 'register' ? 'active' : ''}" data-tab="register">Đăng ký</button>
            </div>
            <form id="auth-form" autocomplete="on" novalidate>
              <div class="field f-name"><label>Tên đăng nhập</label>
                <input class="input" name="username" maxlength="${NAME_MAX_LENGTH}" autocomplete="username" required /></div>
              ${tab === 'register' ? `<ul class="checklist" id="name-rules">
                <li data-rule="len">${NAME_MIN_LENGTH}–${NAME_MAX_LENGTH} ký tự</li>
                <li data-rule="chars">Bắt đầu bằng chữ cái; chỉ chữ không dấu, số, dấu _</li>
              </ul>` : ''}
              <div class="field f-pass"><label>Mật khẩu</label>
                <input class="input" type="password" name="password" maxlength="${PASSWORD_MAX_LENGTH}" autocomplete="${tab === 'login' ? 'current-password' : 'new-password'}" required /></div>
              ${tab === 'register' ? `
                <ul class="checklist" id="pw-rules">
                  <li data-rule="len">${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} ký tự</li>
                  <li data-rule="upper">Chữ in hoa A-Z</li>
                  <li data-rule="lower">Chữ thường a-z</li>
                  <li data-rule="digit">Chữ số 0-9</li>
                  <li data-rule="special">Ký tự đặc biệt !@#…</li>
                  <li data-rule="space">Không khoảng trắng</li>
                  <li data-rule="name" class="wide">Không chứa tên đăng nhập</li>
                </ul>
                <div class="field f-confirm"><label>Nhập lại mật khẩu</label>
                  <input class="input" type="password" name="confirm" maxlength="${PASSWORD_MAX_LENGTH}" autocomplete="new-password" required /></div>
                <div class="field f-avatar"><label>Chọn ảnh đại diện</label>
                  ${avatarPicker(avatar)}</div>
                <div class="hp-field" aria-hidden="true"><label>Để trống ô này<input name="website" tabindex="-1" autocomplete="off" /></label></div>` : ''}
              <div class="error" id="auth-error"></div>
              <button class="btn primary big block" type="submit">${tab === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}</button>
            </form>
          </div>
        </div>
      </div>`);

    this.ui.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => this.showAuth(b.dataset.tab as 'login' | 'register')),
    );
    const form = $('#auth-form') as HTMLFormElement;
    const shownAt = performance.now();
    const nameInput = form.elements.namedItem('username') as HTMLInputElement;
    const pwInput = form.elements.namedItem('password') as HTMLInputElement;
    const errorBox = $('#auth-error');

    if (tab === 'register') {
      const setRule = (list: string, rule: string, ok: boolean) =>
        this.ui.querySelector(`#${list} [data-rule="${rule}"]`)?.classList.toggle('ok', ok);
      const check = () => {
        const n = nameInput.value.trim();
        const p = pwInput.value;
        setRule('name-rules', 'len', n.length >= NAME_MIN_LENGTH && n.length <= NAME_MAX_LENGTH);
        setRule('name-rules', 'chars', /^[A-Za-z][A-Za-z0-9_]*$/.test(n));
        setRule('pw-rules', 'len', p.length >= PASSWORD_MIN_LENGTH && p.length <= PASSWORD_MAX_LENGTH);
        setRule('pw-rules', 'upper', /[A-Z]/.test(p));
        setRule('pw-rules', 'lower', /[a-z]/.test(p));
        setRule('pw-rules', 'digit', /[0-9]/.test(p));
        setRule('pw-rules', 'special', /[^A-Za-z0-9\s]/.test(p));
        setRule('pw-rules', 'space', p.length > 0 && !/\s/.test(p));
        setRule('pw-rules', 'name', p.length > 0 && (n.length < NAME_MIN_LENGTH || !p.toLowerCase().includes(n.toLowerCase())));
      };
      nameInput.addEventListener('input', check);
      pwInput.addEventListener('input', check);
      this.ui.querySelectorAll<HTMLElement>('[data-avatar]').forEach((b) =>
        b.addEventListener('click', () => {
          avatar = b.dataset.avatar!;
          this.ui.querySelectorAll('[data-avatar]').forEach((x) => x.classList.toggle('active', x === b));
        }),
      );
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      unlockAudio();
      errorBox.textContent = '';
      const username = nameInput.value.trim();
      const password = pwInput.value;
      if (tab === 'register') {
        const errors = [...validateUsername(username), ...validatePassword(password, username)];
        const confirm = (form.elements.namedItem('confirm') as HTMLInputElement).value;
        if (!errors.length && confirm !== password) errors.push('Mật khẩu nhập lại không khớp.');
        if (errors.length) {
          errorBox.textContent = errors[0];
          return;
        }
      } else if (!username || !password) {
        errorBox.textContent = 'Vui lòng nhập tên đăng nhập và mật khẩu.';
        return;
      }
      const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = tab === 'login' ? 'Đang đăng nhập…' : 'Đang tạo tài khoản…';
      const slow = window.setTimeout(() => {
        if (!errorBox.textContent) errorBox.innerHTML = `<span class="muted">${esc(SERVER_WAKING_TEXT)}</span>`;
      }, 4000);
      try {
        const website = (form.elements.namedItem('website') as HTMLInputElement | null)?.value ?? '';
        const res = tab === 'login'
          ? await api.login(username, password)
          : await api.register(username, password, avatar, Math.round(performance.now() - shownAt), website);
        setToken(res.token);
        this.onLoggedIn(res.user);
        if (tab === 'register') void showStoryDialog(res.user.username);
      } catch (err) {
        errorBox.textContent = (err as Error).message;
        btn.disabled = false;
        btn.textContent = label;
      } finally {
        clearTimeout(slow);
      }
    });
  }

  private onLoggedIn(user: PublicUser) {
    this.user = user;
    setDevtoolsAllowed(user.role === 'admin');
    if (useTouchControls()) void syncLayouts(user.id);
    this.connect();
    this.showLobby();
    window.setTimeout(() => loadGame().catch(() => undefined), 300);
  }

  private logout() {
    setToken(null);
    this.gameLoad++;
    this.closeLayoutEditor();
    this.session?.destroy();
    this.session = null;
    if (this.socket?.connected) {
      if (this.room) this.socket.emit('room:leave');
      if (this.queue?.inQueue) this.socket.emit('queue:leave');
    }
    disconnectSocket();
    this.socket = null;
    this.social.detach();
    this.socialPanel.reset();
    this.net.set('hidden');
    this.user = null;
    this.room = null;
    this.roomList = null;
    this.liveMatches = null;
    this.browserTab = 'rooms';
    this.party = null;
    this.queue = null;
    this.adminQuery = '';
    this.adminAccounts = [];
    this.clearPending();
    this.showAuth('login');
  }

  // ---------------------------------------------------------------- socket

  private connect() {
    if (this.socket) return;
    const s = connectSocket();
    this.socket = s;
    this.social.attach(s, this.user!);
    let everConnected = false;
    let lostAt = 0;
    const slowTimer = window.setTimeout(() => {
      if (!s.connected) this.net.set('connecting', SERVER_WAKING_TEXT);
    }, 1500);
    s.on('connect', () => {
      clearTimeout(slowTimer);
      this.net.set('hidden');
      if (everConnected && lostAt) toast('Đã kết nối lại máy chủ');
      everConnected = true;
      lostAt = 0;
      this.syncRoomWatch();
    });
    s.on('disconnect', (reason) => {
      this.watchingRooms = false;
      this.watchingMatches = false;
      if (reason === 'io client disconnect') return;
      this.clearPending();
      lostAt = Date.now();
      this.net.set('lost');
    });
    s.on('connect_error', (err) => {
      if (err.message === 'unauthorized') {
        toast('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.', 'error');
        this.logout();
        return;
      }
      if (err.message === 'too_many_connections') {
        this.net.set(everConnected ? 'lost' : 'connecting', 'Mạng của bạn đang mở quá nhiều kết nối, đang thử lại…');
        return;
      }
      this.net.set(everConnected ? 'lost' : 'connecting', everConnected ? undefined : SERVER_WAKING_TEXT);
    });
    s.on('lobby:ready', () => {
      const pending = sessionStorage.getItem(PENDING_ROOM_KEY);
      if (pending) {
        sessionStorage.removeItem(PENDING_ROOM_KEY);
        s.emit('room:join', pending);
      }
      const pendingParty = sessionStorage.getItem(PENDING_PARTY_KEY);
      if (pendingParty) {
        sessionStorage.removeItem(PENDING_PARTY_KEY);
        if (!pending) s.emit('party:join', pendingParty);
      }
      // the server only says "lobby" when we are no longer in a match, so a live session means it ended while we were away
      if (this.session && !this.session.isEnded) {
        const observer = this.session.observer;
        this.session.destroy();
        this.session = null;
        toast(observer ? 'Mất kết nối, đã thoát chế độ xem trận.' : 'Trận đấu đã kết thúc trong lúc bạn mất kết nối.', 'error', 5000);
        this.showLobby();
        this.refreshUser();
      } else if (this.screen === 'game' && !this.session) {
        this.showLobby();
      }
    });
    s.on('queue:status', (msg: QueueStatusMsg) => {
      this.clearPending();
      if (msg.inQueue) {
        if (!this.queue?.inQueue) this.queueSince = Date.now() - msg.waitedMs;
        this.queue = msg;
        if (this.screen === 'queue' || this.screen === 'lobby' || this.screen === 'party') this.showQueue();
      } else {
        this.queue = null;
        if (this.screen === 'queue') this.showLobby();
      }
    });
    s.on('party:state', (msg: PartyStateMsg) => {
      this.clearPending();
      this.party = msg;
      if (this.screen === 'party' || this.screen === 'lobby') this.showLobby();
    });
    s.on('party:closed', (info?: { reason?: string }) => {
      this.clearPending();
      const had = this.party !== null;
      this.party = null;
      if (had && info?.reason === 'kicked') toast('Bạn đã bị trưởng nhóm mời ra khỏi nhóm.', 'error', 4000);
      if (had && info?.reason === 'gone') toast('Nhóm đã giải tán trong lúc bạn mất kết nối.', 'error', 4000);
      if (this.screen === 'party') this.showLobby();
    });
    s.on('party:invite', (msg: PartyInviteMsg) => void this.onPartyInvite(msg));
    s.on('party:invited', (e: { userId: string }) => {
      this.invitedAt.set(e.userId, Date.now());
      toast(`Đã gửi lời mời tới ${this.social.friend(e.userId)?.username ?? 'bạn bè'}`);
      if (this.screen === 'party') this.renderPartyFriends();
    });
    s.on('room:state', (msg: RoomStateMsg) => {
      this.clearPending();
      this.room = msg;
      if (this.screen === 'room' || this.screen === 'lobby') this.showRoom();
    });
    s.on('rooms:list', (list: RoomSummary[]) => {
      this.roomList = list;
      if (this.screen === 'lobby') this.renderRoomList();
    });
    s.on('matches:list', (list: LiveMatchSummary[]) => {
      this.liveMatches = list;
      if (this.screen === 'lobby') this.renderRoomList();
    });
    s.on('match:kicked', () => this.leaveGame('Bạn đã bị admin kích khỏi trận đấu.'));
    s.on('match:closed', (info?: { text?: unknown }) =>
      this.leaveGame(typeof info?.text === 'string' ? info.text : 'Trận đấu đã đóng.', 'info'));
    s.on('observe:ended', (info?: { winnerName?: string }) =>
      this.leaveGame(`Trận đấu đã kết thúc${info?.winnerName ? `, người thắng: ${info.winnerName}` : ''}.`, 'info'));
    s.on('room:closed', (info?: { reason?: string }) => {
      this.clearPending();
      const had = this.room !== null;
      this.room = null;
      if (had && info?.reason === 'gone') toast('Phòng chờ đã đóng trong lúc bạn mất kết nối.', 'error', 4000);
      if (this.screen === 'room') this.showLobby();
    });
    s.on('error:msg', (m: { text: string }) => {
      this.clearPending();
      toast(m.text, 'error');
    });
    s.on('match:start', (msg: MatchStartMsg) => {
      this.clearPending();
      this.startGame(msg);
    });
    s.on('account:deleted', () => {
      this.logout();
      toast('Tài khoản của bạn đã bị quản trị viên xoá.', 'error', 10000);
    });
    s.on('session:replaced', () => {
      disconnectSocket();
      this.socket = null;
      this.social.detach();
      this.socialPanel.reset();
      this.net.set('hidden');
      this.gameLoad++;
      this.session?.destroy();
      this.session = null;
      this.showMessage('Tài khoản đang được dùng ở nơi khác', 'Bạn vừa đăng nhập trên một thiết bị hoặc tab khác.', () => {
        this.connect();
        this.showLobby();
      });
    });
  }

  /** The server ended our part in a match (kicked, or the watched match is over): back to the lobby with a note. */
  private leaveGame(text: string, kind: 'info' | 'error' = 'error') {
    if (!this.session && this.screen !== 'game') return;
    this.gameLoad++;
    this.session?.destroy();
    this.session = null;
    toast(text, kind, 6000);
    this.showLobby();
    this.refreshUser();
  }

  private startGame(msg: MatchStartMsg) {
    if (this.session && this.session.matchId === msg.matchId && !this.session.isEnded) {
      this.session.resync(msg);
      return;
    }
    this.closeLayoutEditor();
    this.session?.destroy();
    this.session = null;
    this.queue = null;
    this.room = null;
    if (this.party) this.party.inQueue = false;
    window.clearInterval(this.queueTimer);
    const load = ++this.gameLoad;
    this.render('game', '');
    // the chunk is normally prefetched in the lobby; only a very fast start shows the loader
    let ready = false;
    window.setTimeout(() => {
      if (!ready && load === this.gameLoad) this.ui.innerHTML = `<div class="screen centered"><div>${walker('Đang vào trận')}</div></div>`;
    }, 150);
    loadGame()
      .then(({ GameSession }) => {
        ready = true;
        if (load !== this.gameLoad || !this.socket) return;
        this.ui.innerHTML = '';
        this.session = new GameSession(msg, this.socket, () => {
          this.session = null;
          this.showLobby();
          this.refreshUser();
        });
      })
      .catch((err) => {
        ready = true;
        if (load !== this.gameLoad) return;
        this.showMessage('Không tải được trận đấu', (err as Error).message, () => this.startGame(msg));
      });
  }

  private refreshUser() {
    api.me().then(({ user }) => {
      this.user = user;
      setDevtoolsAllowed(user.role === 'admin');
      this.social.setMe(user);
      if (this.screen === 'lobby') this.showLobby();
    }).catch(() => undefined);
  }

  // ---------------------------------------------------------------- lobby

  private header(current: NavKey | null = null): string {
    const u = this.user!;
    const level = levelFromXp(u.xp);
    const from = xpForLevel(level);
    const to = xpForLevel(level + 1);
    const pct = ((u.xp - from) / (to - from)) * 100;
    const info = `${u.username} · Cấp ${level} · ${u.xp - from}/${to - from} XP`;
    return `<div class="topbar">
      <button type="button" class="player-chip${current === 'profile' ? ' active' : ''}" data-nav="profile"
        title="${esc(info)} · Xem hồ sơ" aria-label="${esc(info)}. Xem hồ sơ">
        <span class="xp-ring" style="--xp:${pct.toFixed(1)}%"><span class="avatar">${esc(u.avatar)}</span><span class="lv-badge">${level}</span></span>
        <span class="chip-info">
          <span class="chip-name">${nameHtml(u.username, u.role === 'admin', false)}</span>
          <span class="chip-meta muted">${u.role === 'admin' ? '🛡️ Quản trị · ' : ''}Cấp ${level} · ${u.xp - from}/${to - from} XP</span>
          <span class="xpbar"><span style="width:${pct.toFixed(1)}%"></span></span>
        </span>
      </button>
      <div class="row topbar-actions">
        ${[...(useTouchControls() ? TOUCH_NAV_BUTTONS : NAV_BUTTONS), ...(this.isAdmin ? [ADMIN_NAV_BUTTON] : [])].map(([nav, icon, label]) => `<button class="btn small tool-btn${nav === current ? ' active' : ''}" data-nav="${nav}" title="${label}" aria-label="${label}"${nav === current ? ' aria-current="page"' : ''}><span>${icon}</span><em>${label}</em></button>`).join('')}
        <button class="btn small logout-btn" data-nav="logout" title="Đăng xuất" aria-label="Đăng xuất"><i aria-hidden="true">🚪</i><em>Đăng xuất</em></button>
      </div>
    </div>`;
  }

  private bindNav() {
    this.ui.querySelectorAll<HTMLElement>('[data-nav]').forEach((b) =>
      b.addEventListener('click', () => {
        unlockAudio();
        this.navTo(b.dataset.nav as NavKey | 'logout');
      }),
    );
  }

  private navTo(nav: NavKey | 'logout') {
    switch (nav) {
      case 'lobby': return this.showLobby();
      case 'logout': return this.logout();
      case 'profile': return this.showProfile();
      case 'ranks': return void this.showRanks();
      case 'admin': return void this.showAdmin();
      case 'controls': return void this.showControls();
      case 'guide': return this.showPanel('guide', '📖 Hướng dẫn chơi', guidePanel());
      case 'items': return this.showPanel('items', '🎒 Vật phẩm trong game', itemsPanel());
      case 'keys': return this.showPanel('keys', '⌨️ Phím tắt', keysPanel());
      case 'settings':
        return this.showPanel('settings', '⚙️ Cài đặt', settingsPanel(true), (root) => bindSettings(root, () => void this.showControls()));
    }
  }

  showLobby() {
    if (!this.user) return this.showAuth('login');
    if (this.queue?.inQueue) return this.showQueue();
    if (this.room) return this.showRoom();
    if (this.party) return this.showParty();
    const team = savedTeamSize();
    this.render('lobby', `
      <div class="screen"><div class="container lobby">
        ${this.header('lobby')}
        <div class="lobby-main">
          <div class="lobby-hero">
            <div class="logo-kicker">Huyền sử Văn Lang</div>
            <div class="logo">BÁ KHÍ<span>TRỜI NAM 2D</span></div>
            <div class="subtitle">${TAGLINE}</div>
          </div>
          <div class="lobby-body">
            <aside class="room-browser" aria-label="${this.isAdmin ? 'Phòng đang mở và trận đang đấu' : 'Phòng đang mở'}">
              <div class="card room-browser-card">
                ${this.isAdmin
                  ? `<div class="browser-tabs" role="tablist" aria-label="Danh sách">
                      <button type="button" role="tab" data-tab="rooms" aria-selected="${this.browserTab === 'rooms'}">🏮 Phòng chờ <span class="badge" id="room-count"></span></button>
                      <button type="button" role="tab" data-tab="live" aria-selected="${this.browserTab === 'live'}" title="Chỉ quản trị viên thấy">⚔️ Đang đấu <span class="badge" id="live-count"></span></button>
                    </div>`
                  : '<div class="room-browser-head"><h3>🏮 Phòng đang mở</h3><span class="badge" id="room-count"></span></div>'}
                <p class="room-browser-sum muted" id="room-sum"></p>
                <div class="room-list ui-scroll" id="room-list" aria-live="polite"></div>
                <button class="btn primary block" id="browser-create">＋ Tạo phòng mới</button>
              </div>
            </aside>
            <div class="modes">
              <div class="card mode-card" data-mode="pvp">
                <div class="icon">${MODE_ICONS.pvp}</div><h3>Đấu người</h3>
                <p>Ghép trận tự động trên bản đồ ${esc(MAP_DEFS[DEFAULT_MAP].name)}.</p>
                <div class="diff-seg" role="radiogroup" aria-label="Kiểu ghép trận">
                  ${TEAM_SIZES.map((n) => `<button type="button" role="radio" data-team="${n}" aria-checked="${n === team}">${TEAM_SIZE_NAMES[n]}</button>`).join('')}
                </div>
                <div class="ornament"></div>
                <span class="btn primary mode-cta" id="pvp-cta">${team === 1 ? 'Tìm trận' : 'Lập nhóm'}</span>
              </div>
              <div class="card mode-card" data-mode="bots">
                <div class="icon">${MODE_ICONS.bots}</div><h3>${MODE_NAMES.bots}</h3>
                <p>Vào trận ngay, bot lấp đầy bản đồ bạn chọn.</p>
                <div class="diff-seg" role="radiogroup" aria-label="Độ khó của bot">
                  ${BOT_DIFFICULTIES.map((d) => `<button type="button" role="radio" data-diff="${d}" aria-checked="${d === savedBotDifficulty()}">${BOT_DIFFICULTY_NAMES[d]}</button>`).join('')}
                </div>
                <div class="ornament"></div>
                <span class="btn primary mode-cta">Chọn bản đồ</span>
              </div>
              <div class="card mode-card" data-mode="private">
                <div class="icon">${MODE_ICONS.private}</div><h3>${MODE_NAMES.private}</h3>
                <p>Tạo phòng riêng, mời bạn bè bằng mã hoặc link.</p>
                <div class="ornament"></div>
                <button class="btn primary mode-cta" id="create-room">Tạo phòng</button>
                <div class="join-row">
                  <input class="input" id="room-code" placeholder="Mã phòng / link mời" />
                  <button class="btn" id="join-room">Vào</button>
                </div>
              </div>
              <div class="card mode-card" data-mode="training">
                <div class="icon">${MODE_ICONS.training}</div><h3>${MODE_NAMES.training}</h3>
                <p>Bắn lợn rừng ở làn ${TRAINING_LANES[0].distance}–${TRAINING_LANES[TRAINING_LANES.length - 1].distance}. Có sẵn cung nỏ, không mất máu.</p>
                <div class="ornament"></div>
                <span class="btn primary mode-cta">Vào tập bắn</span>
              </div>
            </div>
          </div>
        </div>
      </div></div>`);
    this.bindNav();
    this.renderRoomList();
    $('#browser-create').addEventListener('click', () => this.openCreateRoom());
    $('#room-list').addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const watch = target.closest<HTMLButtonElement>('[data-watch]');
      if (watch) {
        unlockAudio();
        this.send('observe:start', watch.dataset.watch, true);
        return;
      }
      const row = target.closest<HTMLButtonElement>('[data-join]');
      if (!row || row.disabled) return;
      unlockAudio();
      this.send('room:join', row.dataset.join, true);
    });
    this.ui.querySelectorAll<HTMLElement>('.browser-tabs [data-tab]').forEach((tab) =>
      tab.addEventListener('click', () => {
        this.browserTab = tab.dataset.tab === 'live' ? 'live' : 'rooms';
        this.ui.querySelectorAll<HTMLElement>('.browser-tabs [data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
        this.renderRoomList();
      }),
    );
    this.ui.querySelector('[data-mode="pvp"]')!.addEventListener('click', (e) => {
      const pick = (e.target as HTMLElement).closest<HTMLElement>('[data-team]');
      if (pick) {
        const n = Number(pick.dataset.team);
        if (!isTeamSize(n)) return;
        localStorage.setItem(TEAM_SIZE_KEY, String(n));
        this.ui.querySelectorAll<HTMLElement>('[data-team]').forEach((b) => b.setAttribute('aria-checked', String(b === pick)));
        $('#pvp-cta').textContent = n === 1 ? 'Tìm trận' : 'Lập nhóm';
        return;
      }
      unlockAudio();
      const size = savedTeamSize();
      if (size === 1) this.send('queue:join', undefined, true);
      else this.send('party:create', size, true);
    });
    this.ui.querySelector('[data-mode="bots"]')!.addEventListener('click', (e) => {
      const diff = (e.target as HTMLElement).closest<HTMLElement>('[data-diff]');
      if (!diff) return this.openMapPicker();
      localStorage.setItem(BOT_DIFFICULTY_KEY, diff.dataset.diff!);
      this.ui.querySelectorAll<HTMLElement>('[data-diff]').forEach((b) => b.setAttribute('aria-checked', String(b === diff)));
    });
    this.ui.querySelector('[data-mode="training"]')!.addEventListener('click', () => {
      unlockAudio();
      this.send('training:start', undefined, true);
    });
    $('#create-room').addEventListener('click', (e) => {
      e.stopPropagation();
      this.openCreateRoom();
    });
    const joinInput = $('#room-code') as HTMLInputElement;
    joinInput.addEventListener('click', (e) => e.stopPropagation());
    const join = (e: Event) => {
      e.stopPropagation();
      const raw = joinInput.value.trim();
      const match = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(raw);
      if (!match || !isUuid(match[0])) return toast('Mã phòng không hợp lệ.', 'error');
      this.send('room:join', match[0].toLowerCase(), true);
    };
    $('#join-room').addEventListener('click', join);
    joinInput.addEventListener('keydown', (e) => e.key === 'Enter' && join(e));
  }

  private openMapPicker() {
    if (this.ui.querySelector('.map-picker')) return;
    let choice = savedMapChoice();
    const box = document.createElement('div');
    box.className = 'overlay map-picker';
    box.innerHTML = `<div class="card">
      <h2>🗺️ Chọn bản đồ</h2>
      <p class="muted">Cây cối, nhà cửa cố định theo bản đồ; vật phẩm mỗi trận rải ngẫu nhiên.</p>
      <div class="map-grid">${MAP_CHOICES.map((id) => mapTile(id, id === choice, false, false)).join('')}</div>
      <div class="row btn-pair">
        <button class="btn" data-a="cancel">Hủy</button>
        <button class="btn primary" data-a="go">▶ Vào trận</button>
      </div></div>`;
    const close = () => {
      box.remove();
      window.removeEventListener('keydown', onKey);
    };
    const go = () => {
      localStorage.setItem(MAP_CHOICE_KEY, choice);
      unlockAudio();
      if (this.send('bot:start', { map: choice, difficulty: savedBotDifficulty() }, true)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!box.isConnected) return window.removeEventListener('keydown', onKey);
      if (e.key === 'Escape') close();
      if (e.key === 'Enter') go();
    };
    box.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === box) return close();
      const tile = t.closest<HTMLElement>('[data-map]');
      if (tile && isMapChoice(tile.dataset.map)) {
        if (tile.dataset.map === choice && e.detail > 1) return go();
        choice = tile.dataset.map;
        box.querySelectorAll('[data-map]').forEach((b) => b.classList.toggle('active', b === tile));
        return;
      }
      const a = t.closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a === 'cancel') close();
      if (a === 'go') go();
    });
    window.addEventListener('keydown', onKey);
    this.ui.appendChild(box);
    paintPreviews(box);
    box.querySelector<HTMLElement>('[data-a="go"]')?.focus();
  }

  /** Fills the lobby's room list; only this box redraws when the server pushes a new list. */
  private renderRoomList() {
    const box = this.ui.querySelector<HTMLElement>('#room-list');
    if (!box) return;
    const list = this.roomList;
    const count = this.ui.querySelector<HTMLElement>('#room-count');
    if (count) count.textContent = list ? String(list.length) : '…';
    const liveCount = this.ui.querySelector<HTMLElement>('#live-count');
    if (liveCount) liveCount.textContent = this.liveMatches ? String(this.liveMatches.length) : '…';
    const live = this.isAdmin && this.browserTab === 'live';
    const create = this.ui.querySelector<HTMLElement>('#browser-create');
    if (create) create.hidden = live;
    if (live) return this.renderLiveList(box);
    const sum = this.ui.querySelector<HTMLElement>('#room-sum');
    if (sum) {
      const humans = list?.reduce((n, r) => n + r.humans, 0) ?? 0;
      sum.textContent = list?.length ? `${list.length} phòng · ${humans} người đang chờ` : '';
      sum.hidden = !list?.length;
    }
    if (!list) {
      box.innerHTML = '<p class="room-empty muted">Đang tải danh sách phòng…</p>';
      return;
    }
    if (!list.length) {
      box.innerHTML = `<div class="room-empty"><div class="room-empty-icon" aria-hidden="true">🏮</div>
        <b>Chưa có phòng nào đang mở</b><span class="muted">Tạo phòng để rủ mọi người cùng chơi!</span></div>`;
      return;
    }
    box.innerHTML = list.map((r) => {
      const full = r.players >= r.max;
      const map = mapInfo(r.map);
      const team = isTeamSize(r.teamSize) ? TEAM_SIZE_NAMES[r.teamSize] : TEAM_SIZE_NAMES[1];
      const bots = r.players - r.humans;
      const free = Math.max(0, r.max - r.players);
      const fill = r.max > 0 ? Math.min(100, Math.max(3, (r.players / r.max) * 100)) : 100;
      const crowd = full ? 'full' : r.players / r.max >= 0.8 ? 'busy' : r.humans >= 2 ? 'lively' : '';
      const summary = `${r.humans} người chơi${bots ? `, ${bots} bot` : ''} · ${full ? 'đã đầy' : `còn ${free}/${r.max} chỗ`}`;
      return `<button type="button" class="room-row${full ? ' full' : ''}" data-join="${esc(r.id)}" ${full ? 'disabled' : ''}
          title="${esc(`${r.name} · chủ phòng ${r.host.name} · ${summary}`)}" aria-label="${esc(`${r.name}, ${summary}`)}">
        <span class="room-row-name">${esc(r.name)}</span>
        <span class="room-row-count ${crowd}"><b>👥 ${r.humans}</b><small>người</small></span>
        <span class="room-row-meta"><span class="room-row-host">${esc(r.host.avatar)} ${nameHtml(r.host.name, r.host.admin, false)}</span>
          <span>${map.icon} ${esc(map.name)} · ${esc(team)}</span></span>
        <span class="room-row-go">${full ? 'Đầy' : 'Vào ›'}</span>
        <span class="room-row-cap" aria-hidden="true">
          <span class="room-row-fill"><i class="${crowd}" style="width:${fill.toFixed(1)}%"></i></span>
          <span class="room-row-slots">${bots ? `🤖 ${bots} · ` : ''}${full ? 'hết chỗ' : `còn ${free} chỗ`}</span>
        </span>
      </button>`;
    }).join('');
  }

  /** Admin tab of the room browser: matches being played, each one open to watch. */
  private renderLiveList(box: HTMLElement) {
    const list = this.liveMatches;
    const sum = this.ui.querySelector<HTMLElement>('#room-sum');
    if (sum) {
      const humans = list?.reduce((n, m) => n + m.humans, 0) ?? 0;
      sum.textContent = list?.length ? `${list.length} trận · ${humans} người đang chơi · chỉ quản trị viên thấy` : '';
      sum.hidden = !list?.length;
    }
    if (!list) {
      box.innerHTML = '<p class="room-empty muted">Đang tải danh sách trận…</p>';
      return;
    }
    if (!list.length) {
      box.innerHTML = `<div class="room-empty"><div class="room-empty-icon" aria-hidden="true">⚔️</div>
        <b>Chưa có trận nào đang đấu</b><span class="muted">Trận ghép, đấu bot và phòng bạn bè sẽ hiện ở đây khi bắt đầu.</span></div>`;
      return;
    }
    box.innerHTML = list.map((m) => {
      const map = mapInfo(m.mapId);
      const title = m.name || MODE_NAMES[m.mode];
      const team = isTeamSize(m.teamSize) ? TEAM_SIZE_NAMES[m.teamSize] : TEAM_SIZE_NAMES[1];
      const bots = m.players - m.humans;
      const fill = m.players > 0 ? Math.min(100, Math.max(3, (m.alive / m.players) * 100)) : 0;
      const clock = m.lobby ? '🏯 Phòng chờ' : `⏱ ${formatDuration(m.elapsedMs)}`;
      const summary = `${m.alive}/${m.players} còn sống · ${m.humans} người chơi${bots > 0 ? `, ${bots} bot` : ''}`;
      return `<button type="button" class="room-row live-row" data-watch="${esc(m.id)}"
          title="${esc(`${title} · ${MODE_NAMES[m.mode]} · ${summary}`)}" aria-label="${esc(`Xem trận ${title}, ${summary}`)}">
        <span class="room-row-name">${LIVE_MODE_ICONS[m.mode]} ${esc(title)}</span>
        <span class="room-row-count lively"><b>❤️ ${m.alive}</b><small>còn sống</small></span>
        <span class="room-row-meta"><span>${esc(MODE_NAMES[m.mode])} · ${esc(team)}</span>
          <span>${map.icon} ${esc(map.name)} · 👤 ${m.humans}${bots > 0 ? ` · 🤖 ${bots}` : ''}</span></span>
        <span class="room-row-go">👁 Xem ›</span>
        <span class="room-row-cap" aria-hidden="true">
          <span class="room-row-fill"><i class="lively" style="width:${fill.toFixed(1)}%"></i></span>
          <span class="room-row-slots">${clock}${m.observers ? ` · 🛡️ ${m.observers}` : ''}</span>
        </span>
      </button>`;
    }).join('');
  }

  private openCreateRoom() {
    if (document.querySelector('.create-room')) return;
    let teamSize = savedRoomTeam();
    const listed = localStorage.getItem(ROOM_LISTED_KEY) !== '0';
    const box = html(`<div class="overlay create-room" role="dialog" aria-modal="true" aria-labelledby="create-room-title">
      <form class="card" novalidate>
        <h2 id="create-room-title">🏮 Tạo phòng</h2>
        <div class="field"><label for="new-room-name">Tên phòng</label>
          <input class="input" id="new-room-name" maxlength="${ROOM_NAME_MAX_LENGTH}" autocomplete="off"
            placeholder="Phòng của ${esc(this.user!.username)}" value="${esc(localStorage.getItem(ROOM_NAME_KEY) ?? '')}" />
          <small class="muted field-hint"><span id="new-room-len">0</span>/${ROOM_NAME_MAX_LENGTH} ký tự · để trống sẽ dùng tên mặc định</small></div>
        <div class="field"><label>Kiểu đội</label>
          <div class="diff-seg room-team-seg" role="radiogroup" aria-label="Kiểu đội">
            ${TEAM_SIZES.map((n) => `<button type="button" role="radio" data-size="${n}" aria-checked="${n === teamSize}">${TEAM_SIZE_NAMES[n]}</button>`).join('')}
          </div></div>
        <label class="switch-row">
          <input type="checkbox" id="new-room-listed" ${listed ? 'checked' : ''} />
          <span class="switch" aria-hidden="true"></span>
          <span><b>Hiện ở danh sách phòng ngoài sảnh</b><small class="muted">Tắt: chỉ người có mã phòng hoặc link mời mới vào được.</small></span>
        </label>
        <div class="row btn-pair">
          <button type="button" class="btn" data-a="cancel">Hủy</button>
          <button type="submit" class="btn primary">Tạo phòng</button>
        </div>
      </form></div>`);
    const form = box.querySelector('form')!;
    const name = box.querySelector<HTMLInputElement>('#new-room-name')!;
    const len = box.querySelector<HTMLElement>('#new-room-len')!;
    const showLen = () => (len.textContent = String(name.value.length));
    showLen();
    name.addEventListener('input', showLen);
    const close = () => {
      box.remove();
      window.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    box.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === box || t.closest('[data-a="cancel"]')) return close();
      const pick = t.closest<HTMLElement>('[data-size]');
      const n = Number(pick?.dataset.size);
      if (!pick || !isTeamSize(n)) return;
      teamSize = n;
      box.querySelectorAll<HTMLElement>('[data-size]').forEach((b) => b.setAttribute('aria-checked', String(b === pick)));
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const listedNow = box.querySelector<HTMLInputElement>('#new-room-listed')!.checked;
      const roomName = name.value.trim();
      const nameError = validateRoomName(roomName);
      if (nameError) {
        toast(nameError, 'error');
        name.focus();
        return;
      }
      localStorage.setItem(ROOM_TEAM_KEY, String(teamSize));
      localStorage.setItem(ROOM_LISTED_KEY, listedNow ? '1' : '0');
      localStorage.setItem(ROOM_NAME_KEY, roomName);
      unlockAudio();
      if (this.send('room:create', { teamSize, name: roomName, listed: listedNow }, true)) close();
    });
    window.addEventListener('keydown', onKey, true);
    document.body.appendChild(box);
    name.focus();
    name.select();
  }

  // ---------------------------------------------------------------- queue

  private showQueue() {
    const q = this.queue!;
    const first = this.screen !== 'queue';
    if (first) {
      const teamName = isTeamSize(q.teamSize) ? TEAM_SIZE_NAMES[q.teamSize] : TEAM_SIZE_NAMES[1];
      const partyLine = q.party
        ? `Nhóm ${q.party.members}/${q.teamSize} người · ${q.party.members >= q.teamSize ? 'đã đủ đội' : q.party.fill ? 'ghép thêm người lạ cho đủ đội' : 'không ghép thêm ai'}`
        : q.teamSize > 1 ? 'Sẽ được ghép với người chơi ngẫu nhiên cho đủ đội' : 'Mỗi người một đội, trụ lại cuối cùng để thắng';
      this.render('queue', `
        <div class="screen fit"><div class="container">${this.header('lobby')}
          <div class="center-fill"><div class="narrow q-wrap"><div class="card center q-card">
            <h2>⚔️ Đang tìm trận <span class="badge gold">${esc(teamName)}</span></h2>
            <p class="muted q-mode">${esc(partyLine)}</p>
            ${walker('Đang tìm trận')}
            <div class="logo q-count" id="q-count"></div>
            <p class="muted">Thời gian chờ: <b id="q-time">0:00</b></p>
            <div id="q-notice"></div>
            <div class="spacer"></div>
            <div class="menu-list">
              ${q.party ? '' : '<button class="btn" id="q-bots">🤖 Chuyển sang đấu với bot</button>'}
              <button class="btn danger" id="q-cancel">${q.party ? 'Hủy tìm trận (cả nhóm)' : 'Hủy tìm trận'}</button>
            </div>
          </div></div></div>
        </div></div>`);
      this.bindNav();
      $('#q-cancel').addEventListener('click', () => this.send('queue:leave'));
      this.ui.querySelector('#q-bots')?.addEventListener('click', () => {
        if (!this.send('queue:leave')) return;
        this.socket?.emit('bot:start', { map: savedMapChoice(), difficulty: savedBotDifficulty() });
      });
      window.clearInterval(this.queueTimer);
      this.queueTimer = window.setInterval(() => {
        if (this.screen !== 'queue') return window.clearInterval(this.queueTimer);
        const waited = Date.now() - this.queueSince;
        $('#q-time').textContent = formatDuration(waited);
        this.renderQueueNotice(waited >= QUEUE_NOTICE_AFTER_MS);
      }, 500);
    }
    $('#q-count').textContent = `${q.count} / ${q.needed}`;
    this.renderQueueNotice(q.notice);
  }

  private renderQueueNotice(show: boolean) {
    const box = this.ui.querySelector<HTMLElement>('#q-notice');
    if (!box || (box.childElementCount > 0) === show) return;
    box.innerHTML = show
      ? '<div class="notice">Chế độ này hiện đang có ít người chơi. Bạn có thể chuyển sang <b>Đấu với bot</b> hoặc <b>Phòng bạn bè</b>, hoặc tiếp tục chờ đến khi đủ người.</div>'
      : '';
  }

  // ---------------------------------------------------------------- party (duo / squad)

  private showParty() {
    const party = this.party!;
    const me = this.user!.id;
    const isLeader = party.leaderId === me;
    const count = party.members.length;
    const slots = Array.from({ length: party.size }, (_, i) => {
      const m = party.members[i];
      if (!m) return `<div class="party-slot empty"><span class="slot-plus" aria-hidden="true">＋</span><small>${party.fill ? 'Ghép ngẫu nhiên' : 'Để trống'}</small></div>`;
      const tags = [
        m.admin ? adminBadge() : '',
        m.id === party.leaderId ? '<span class="badge gold">👑 Trưởng nhóm</span>' : '',
        m.id === me ? '<span class="badge">Bạn</span>' : '',
        m.online ? '' : '<span class="badge danger">Mất kết nối</span>',
      ].join('');
      return `<div class="party-slot${m.id === me ? ' me' : ''}${m.online ? '' : ' offline'}">
        <span class="avatar">${esc(m.avatar)}</span>
        <b title="${esc(m.name)}">${nameHtml(m.name, m.admin, false)}</b>
        <small class="muted">Cấp ${m.level}</small>
        <div class="slot-tags">${tags}</div>
        ${isLeader && m.id !== me ? `<button class="btn small slot-kick" data-kick="${esc(m.id)}" title="Mời ra khỏi nhóm" aria-label="Mời ${esc(m.name)} ra khỏi nhóm">✕</button>` : ''}
      </div>`;
    }).join('');
    const empty = party.size - count;
    const hint = empty <= 0
      ? 'Nhóm đã đủ người.'
      : party.fill
        ? `Còn ${empty} chỗ trống sẽ được ghép với người chơi ngẫu nhiên.`
        : `Nhóm sẽ vào trận chỉ với ${count} người, không ghép thêm ai.`;
    const keepScroll = this.screen === 'party' ? (this.ui.querySelector('#party-friends')?.scrollTop ?? 0) : 0;
    this.render('party', `
      <div class="screen fit"><div class="container">${this.header('lobby')}
        <div class="grid cols-2 fill-grid">
          <div class="card fill-card party-card">
            <div class="row between party-head">
              <h2>👥 Nhóm ${party.size} người</h2>
              ${isLeader ? `<div class="diff-seg party-size" role="radiogroup" aria-label="Số người mỗi đội">
                ${TEAM_SIZES.filter((n) => n > 1).map((n) => `<button type="button" role="radio" data-size="${n}" aria-checked="${n === party.size}" ${n < count ? 'disabled' : ''}>${TEAM_SIZE_NAMES[n]}</button>`).join('')}
              </div>` : ''}
            </div>
            <div class="card-scroll ui-scroll party-body">
              <p class="muted">Ghép trận tự động trên bản đồ ${esc(MAP_DEFS[DEFAULT_MAP].name)}. Đồng đội không bắn trúng nhau, đội trụ lại cuối cùng giành chiến thắng.</p>
              <div class="party-slots size-${party.size}">${slots}</div>
              <label class="switch-row${isLeader ? '' : ' readonly'}">
                <input type="checkbox" id="party-fill" ${party.fill ? 'checked' : ''} ${isLeader ? '' : 'disabled'} />
                <span class="switch" aria-hidden="true"></span>
                <span><b>Ghép thêm người lạ cho đủ đội</b><small class="muted">${party.fill ? 'Bật: chỗ trống được ghép với người chơi ngẫu nhiên.' : 'Tắt: chỉ đi cùng những người đang trong nhóm.'}</small></span>
              </label>
            </div>
            <div class="spacer"></div>
            ${isLeader
              ? `<button class="btn primary big block" id="party-queue">⚔️ Tìm trận</button><p class="muted center party-hint">${esc(hint)}</p>`
              : `<p class="center muted party-hint">Đang chờ trưởng nhóm bắt đầu tìm trận…<br/>${esc(hint)}</p>`}
            <button class="btn danger block" id="party-leave">Rời nhóm</button>
          </div>
          <div class="card fill-card">
            <h2>✉️ Mời bạn bè</h2>
            <div class="card-scroll ui-scroll" id="party-friends"></div>
            <div class="spacer"></div>
            <button class="btn block" id="party-link">🔗 Sao chép link mời vào nhóm</button>
            <p class="muted compact-hide">Gửi link cho bạn bè, người chưa có tài khoản sẽ được yêu cầu đăng ký rồi tự vào nhóm.</p>
          </div>
        </div>
      </div></div>`);
    this.renderPartyFriends();
    $('#party-friends').scrollTop = keepScroll;
    this.bindNav();
    $('#party-leave').addEventListener('click', () => this.send('party:leave'));
    $('#party-link').addEventListener('click', () => void this.copyText(`${location.origin}/?party=${party.id}`, 'link mời vào nhóm'));
    $('#party-friends').addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-invite]')?.dataset.invite;
      if (id) this.send('party:invite', id);
    });
    if (!isLeader) return;
    $('#party-queue').addEventListener('click', () => {
      unlockAudio();
      this.send('party:queue', undefined, true);
    });
    ($('#party-fill') as HTMLInputElement).addEventListener('change', (e) => this.send('party:setFill', (e.target as HTMLInputElement).checked));
    this.ui.querySelector('.party-size')?.addEventListener('click', (e) => {
      const n = Number((e.target as HTMLElement).closest<HTMLElement>('[data-size]')?.dataset.size);
      if (isTeamSize(n) && n > 1 && n !== party.size) {
        localStorage.setItem(TEAM_SIZE_KEY, String(n));
        this.send('party:setSize', n);
      }
    });
    this.ui.querySelectorAll<HTMLElement>('[data-kick]').forEach((b) =>
      b.addEventListener('click', () => this.send('party:kick', b.dataset.kick)),
    );
  }

  /** Online friends first; only the list redraws when presence changes. */
  private renderPartyFriends() {
    const box = this.ui.querySelector<HTMLElement>('#party-friends');
    const party = this.party;
    if (!box || !party) return;
    const order = { online: 0, in_match: 1, offline: 2 } as const;
    const friends = [...this.social.state.friends].sort((a, b) => order[a.presence] - order[b.presence] || a.username.localeCompare(b.username));
    if (!friends.length) {
      box.innerHTML = '<p class="muted">Bạn chưa có bạn bè nào. Mở khung trò chuyện để kết bạn, hoặc gửi link mời bên dưới.</p>';
      return;
    }
    const full = party.members.length >= party.size;
    const now = Date.now();
    box.innerHTML = `<div class="grid">${friends.map((f) => {
      const inParty = party.members.some((m) => m.id === f.id);
      const sent = now - (this.invitedAt.get(f.id) ?? 0) < INVITE_SENT_MS;
      const action = inParty
        ? '<span class="badge gold">Trong nhóm</span>'
        : `<button class="btn small${sent ? '' : ' primary'}" data-invite="${esc(f.id)}" ${f.presence !== 'online' || full || sent ? 'disabled' : ''}>${sent ? 'Đã mời' : 'Mời'}</button>`;
      return `<div class="member${f.presence === 'offline' ? ' dim' : ''}">
        <span class="avatar">${esc(f.avatar)}</span>
        <div class="grow"><b>${nameHtml(f.username, f.admin)}</b>
          <div class="muted presence-line"><i class="dot ${f.presence}"></i>${PRESENCE_TEXT[f.presence]} · Cấp ${f.level}</div></div>
        ${action}
      </div>`;
    }).join('')}</div>`;
    if ([...this.invitedAt.values()].some((t) => now - t < INVITE_SENT_MS)) {
      window.setTimeout(() => this.screen === 'party' && this.renderPartyFriends(), INVITE_SENT_MS + 100);
    }
  }

  private async onPartyInvite(msg: PartyInviteMsg) {
    if (this.screen === 'game' || this.party?.id === msg.partyId) return;
    const ok = await confirmDialog({
      title: `${msg.from.avatar} ${msg.from.username} mời bạn vào nhóm`,
      message: `Cùng ghép trận ${TEAM_SIZE_NAMES[isTeamSize(msg.size) ? msg.size : 2]} trên bản đồ ${MAP_DEFS[DEFAULT_MAP].name}.${this.party ? ' Bạn sẽ rời nhóm hiện tại.' : this.queue?.inQueue ? ' Bạn sẽ rời hàng chờ hiện tại.' : ''}`,
      confirmText: 'Vào nhóm',
      cancelText: 'Để sau',
    });
    // a match may have started while the dialog was open
    if (!ok || (this.screen as Screen) === 'game') return;
    if (this.queue?.inQueue && !this.send('queue:leave')) return;
    if (this.party) this.send('party:leave');
    this.send('party:join', msg.partyId, true);
  }

  // ---------------------------------------------------------------- private room

  private showRoom() {
    const room = this.room!;
    const me = this.user!.id;
    const isHost = room.hostId === me;
    const link = `${location.origin}/?room=${room.id}`;
    const total = room.members.length;
    const botCount = room.members.filter((m) => m.isBot).length;
    const teamSize = isTeamSize(room.teamSize) ? room.teamSize : 1;
    const tags = (m: RoomMember) =>
      `${m.admin ? adminBadge() : ''} ${m.id === room.hostId ? '<span class="badge gold">👑 Chủ phòng</span>' : ''} ${m.isBot ? '<span class="badge">BOT</span>' : ''} ${m.id === me ? '<span class="badge">Bạn</span>' : ''}`;
    const removeBtn = (m: RoomMember) => (isHost && m.isBot ? `<button class="btn small" data-remove="${esc(m.id)}">Xóa</button>` : '');
    let members: string;
    let teamsWithPlayers = 0;
    const unseated = room.members.filter((m) => m.slot === null);
    const iAmUnseated = unseated.some((m) => m.id === me);
    if (teamSize === 1) {
      members = `<div class="grid">${[...room.members].sort((a, b) => (a.slot ?? Infinity) - (b.slot ?? Infinity)).map((m) => `
        <div class="member">
          <span class="avatar">${esc(m.avatar)}</span>
          <div class="grow"><b>${nameHtml(m.name, m.admin, false)}</b> ${tags(m)}
            <div class="muted" style="font-size:12px">Cấp ${m.level}</div></div>
          ${removeBtn(m)}
        </div>`).join('')}</div>`;
    } else {
      // every slot of every team is drawn so players can move themselves into any empty one
      const bySlot = new Map(room.members.filter((m) => m.slot !== null).map((m) => [m.slot!, m]));
      const mySlot = room.members.find((m) => m.id === me)?.slot ?? undefined;
      const teamCount = Math.ceil(room.max / teamSize);
      const waiting = unseated.length
        ? `<div class="room-unseated${iAmUnseated ? ' mine' : ''}">
            <div class="room-team-head"><b>Chưa chọn đội</b><small>${unseated.length}</small></div>
            ${iAmUnseated ? '<p class="room-pick-hint">👇 Bấm "Vào ô này" ở đội bạn muốn tham gia.</p>' : ''}
            <div class="room-unseated-list">${unseated.map((m) => `<span class="room-chip${m.id === me ? ' me' : ''}"><span class="avatar">${esc(m.avatar)}</span>${nameHtml(m.name, m.admin, false)}</span>`).join('')}</div>
          </div>`
        : '';
      members = `${waiting}<div class="room-teams">${Array.from({ length: teamCount }, (_, t) => {
        const slots = Array.from({ length: Math.min(teamSize, room.max - t * teamSize) }, (_, i) => t * teamSize + i);
        const seated = slots.filter((s) => bySlot.has(s)).length;
        if (seated) teamsWithPlayers++;
        const mine = mySlot !== undefined && Math.floor(mySlot / teamSize) === t;
        return `<div class="room-team${mine ? ' mine' : ''}${seated ? '' : ' empty'}">
          <div class="room-team-head"><b>Đội ${t + 1}</b><small>${seated}/${slots.length}</small></div>
          ${slots.map((s) => {
            const m = bySlot.get(s);
            if (!m) return `<button type="button" class="room-slot open" data-slot="${s}" title="Chuyển vào ô này">＋ <span>Vào ô này</span></button>`;
            return `<div class="room-slot${m.id === me ? ' me' : ''}">
              <span class="avatar">${esc(m.avatar)}</span>
              <div class="grow"><b title="${esc(m.name)}">${nameHtml(m.name, m.admin, false)}</b><div class="slot-tags">${tags(m)}</div></div>
              ${isHost && m.isBot ? `<button class="btn small" data-remove="${esc(m.id)}" title="Xóa bot" aria-label="Xóa ${esc(m.name)}">✕</button>` : ''}
            </div>`;
          }).join('')}
        </div>`;
      }).join('')}</div>`;
    }
    const needSeats = teamSize > 1 && unseated.length > 0;
    const needTeams = teamSize > 1 && teamsWithPlayers < 2;
    const canStart = total >= room.min && !needSeats && !needTeams;
    const startHint = total < room.min
      ? `Cần ít nhất ${room.min} người (có thể thêm bot).`
      : needSeats ? `Còn ${unseated.length} người chưa chọn đội.`
        : needTeams ? 'Cần ít nhất 2 đội có người. Chuyển sang ô của đội khác hoặc thêm bot.' : '';
    // the room re-renders on every member change, so keep the list where the player scrolled it
    const keepScroll = this.screen === 'room' ? (this.ui.querySelector('#room-members')?.scrollTop ?? 0) : 0;
    const keepSetupScroll = this.screen === 'room' ? (this.ui.querySelector('#room-setup')?.scrollTop ?? 0) : 0;
    const keepMapsScroll = this.screen === 'room' ? (this.ui.querySelector('#room-maps')?.scrollLeft ?? 0) : 0;
    this.render('room', `
      <div class="screen fit"><div class="container">${this.header('lobby')}
        <div class="grid cols-2 fill-grid">
          <div class="card fill-card room-setup">
            <h2 class="room-title" title="${esc(room.name)}">🏮 ${esc(room.name)}</h2>
            <p class="muted room-visibility">${room.listed ? '🌐 Đang hiện ở danh sách phòng ngoài sảnh, ai cũng vào được.' : '🔒 Phòng kín: chỉ vào được bằng mã phòng hoặc link mời.'}</p>
            <div class="card-scroll ui-scroll" id="room-setup">
            <div class="room-invite">
              <button type="button" class="invite-qr" id="room-qr" title="Phóng to mã QR cho người khác quét" aria-label="Phóng to mã QR cho người khác quét">
                <span class="invite-qr-code">${cachedQrSvg(link) ?? '<span class="invite-qr-wait"></span>'}</span>
                <span class="invite-qr-zoom">🔍 Phóng to</span>
              </button>
              <div class="invite-info">
                <div class="invite-field">
                  <label>Mã phòng</label>
                  <div class="invite-copy"><span class="invite-text selectable" title="${esc(room.id)}">${esc(room.id)}</span><button type="button" class="btn small" id="copy-code" aria-label="Sao chép mã phòng">📋<span> Chép</span></button></div>
                </div>
                <div class="invite-field">
                  <label>Link mời</label>
                  <div class="invite-copy"><span class="invite-text selectable" title="${esc(link)}">${esc(link)}</span><button type="button" class="btn small" id="copy-link" aria-label="Sao chép link mời">🔗<span> Chép</span></button></div>
                </div>
                ${isLocalOnly(link)
                  ? '<p class="invite-hint warn">⚠️ Đang mở bằng localhost: máy khác quét mã sẽ không vào được.</p>'
                  : '<p class="invite-hint muted compact-hide">Quét mã, hoặc gửi mã/link cho bạn bè. Người chưa có tài khoản sẽ đăng ký rồi tự vào phòng.</p>'}
              </div>
            </div>
            <div class="field"><label>Kiểu đội${isHost ? '' : ' <span class="muted">(chủ phòng chọn)</span>'}</label>
              <div class="diff-seg room-team-seg" role="radiogroup" aria-label="Kiểu đội" id="room-team-size">
                ${TEAM_SIZES.map((n) => `<button type="button" role="radio" data-size="${n}" aria-checked="${n === teamSize}" ${isHost ? '' : 'disabled'}>${TEAM_SIZE_NAMES[n]}</button>`).join('')}
              </div>
            </div>
            <div class="field"><label>Bản đồ${isHost ? '' : ' <span class="muted">(chủ phòng chọn)</span>'}</label>
              <div class="map-grid compact" id="room-maps">${MAP_CHOICES.map((id) => mapTile(id, id === room.map, true, !isHost || mapCapacity(id) < total)).join('')}</div>
            </div>
            </div>
          </div>
          <div class="card fill-card">
            <h2>Người chơi (${total}/${room.max})${teamSize > 1 ? ` <span class="badge">${teamsWithPlayers} đội có người</span>` : ''}</h2>
            ${teamSize > 1 ? '<p class="muted room-team-hint">Mỗi người tự bấm vào ô trống của đội mình muốn. Đồng đội không bắn trúng nhau.</p>' : ''}
            <div class="card-scroll ui-scroll" id="room-members">${members}</div>
            <div class="spacer"></div>
            ${isHost ? `
              <div class="row btn-pair">
                <button class="btn" id="add-bot" ${total >= room.max ? 'disabled' : ''}>🤖 Thêm bot</button>
                <button class="btn" id="fill-bots" ${total >= room.max ? 'disabled' : ''} title="Thêm bot cho đủ ${room.max} người">👥 Lấp đủ ${room.max}</button>
              </div>
              ${botCount ? '<div class="spacer"></div><button class="btn block" id="clear-bots">🧹 Xóa hết bot</button>' : ''}
              <div class="spacer"></div>
              <button class="btn primary big block" id="start-room" ${canStart ? '' : 'disabled'}>▶ Bắt đầu (${total}/${room.max})</button>
              ${startHint ? `<p class="muted center">${startHint}</p>` : ''}`
              : '<p class="center muted">Đang chờ chủ phòng bắt đầu trận…</p>'}
            <div class="spacer"></div>
            <button class="btn danger block" id="leave-room">Rời phòng</button>
          </div>
        </div>
      </div></div>`);
    $('#room-members').scrollTop = keepScroll;
    $('#room-setup').scrollTop = keepSetupScroll;
    $('#room-maps').scrollLeft = keepMapsScroll;
    paintPreviews($('#room-maps'));
    this.bindNav();
    const copyButton = (id: string, text: string, label: string) => {
      const btn = $(id);
      const idle = btn.innerHTML;
      btn.addEventListener('click', async () => {
        if (!(await this.copyText(text, label))) return;
        btn.innerHTML = '✓<span> Đã chép</span>';
        btn.classList.add('done');
        window.setTimeout(() => {
          btn.innerHTML = idle;
          btn.classList.remove('done');
        }, 1500);
      });
    };
    copyButton('#copy-code', room.id, 'mã phòng');
    copyButton('#copy-link', link, 'link mời');
    $('#room-qr').addEventListener('click', () => void this.showRoomQr(room.name, room.id, link));
    if (!cachedQrSvg(link)) {
      qrSvg(link).then(
        (svg) => {
          const box = this.ui.querySelector('#room-qr .invite-qr-code');
          if (box && this.room?.id === room.id) box.innerHTML = svg;
        },
        () => {
          const box = this.ui.querySelector('#room-qr .invite-qr-code');
          if (box) box.innerHTML = '<span class="invite-qr-fail">Không tạo được mã QR</span>';
        },
      );
    }
    $('#leave-room').addEventListener('click', () => this.send('room:leave'));
    $('#room-members').addEventListener('click', (e) => {
      const slot = (e.target as HTMLElement).closest<HTMLElement>('[data-slot]')?.dataset.slot;
      if (slot !== undefined) this.send('room:move', Number(slot));
    });
    if (isHost) {
      $('#room-team-size').addEventListener('click', (e) => {
        const n = Number((e.target as HTMLElement).closest<HTMLElement>('[data-size]')?.dataset.size);
        if (isTeamSize(n) && n !== teamSize) {
          localStorage.setItem(ROOM_TEAM_KEY, String(n));
          this.send('room:setTeamSize', n);
        }
      });
      $('#add-bot').addEventListener('click', () => this.send('room:addBot'));
      $('#fill-bots').addEventListener('click', () => this.send('room:fillBots'));
      this.ui.querySelector('#clear-bots')?.addEventListener('click', () => this.send('room:clearBots'));
      $('#start-room').addEventListener('click', () => {
        unlockAudio();
        this.send('room:start', undefined, true);
      });
      this.ui.querySelectorAll<HTMLElement>('[data-remove]').forEach((b) =>
        b.addEventListener('click', () => this.send('room:removeBot', b.dataset.remove)),
      );
      $('#room-maps').addEventListener('click', (e) => {
        const map = (e.target as HTMLElement).closest<HTMLElement>('[data-map]')?.dataset.map;
        if (isMapChoice(map) && map !== room.map) this.send('room:setMap', map);
      });
    }
  }

  // ---------------------------------------------------------------- profile & history

  private async showProfile() {
    this.render('profile', `<div class="screen fit"><div class="container">${this.header('profile')}<div class="center-fill">${walker('Đang tải hồ sơ')}</div></div></div>`);
    this.bindNav();
    try {
      const [{ user }, { stats }, history] = await Promise.all([api.me(), api.stats(), api.history(HISTORY_PAGE_SIZE, 0)]);
      this.user = user;
      if (this.screen !== 'profile') return;
      const level = levelFromXp(user.xp);
      const from = xpForLevel(level);
      const to = xpForLevel(level + 1);
      const losses = Math.max(1, stats.matches - stats.wins);
      const winRate = stats.matches ? ((stats.wins / stats.matches) * 100).toFixed(1) : '0';
      const stat = (v: string | number, l: string) => `<div class="stat"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`;
      this.render('profile', `
        <div class="screen fit"><div class="container">${this.header('profile')}
          <div class="grid cols-2">
            <div class="card profile-info">
              <h2>👤 Thông tin nhân vật</h2>
              <div class="row"><span class="avatar lg">${esc(user.avatar)}</span>
                <div><h3 style="margin:0">${nameHtml(user.username, user.role === 'admin')}</h3>
                  <div class="muted">Cấp ${level} · ${user.xp} XP tổng</div>
                  <div class="xpbar" style="width:200px;margin-top:6px"><div style="width:${((user.xp - from) / (to - from)) * 100}%"></div></div>
                  <div class="muted" style="font-size:12px">Còn ${to - user.xp} XP để lên cấp ${level + 1}</div>
                  <div class="muted profile-joined" style="font-size:12px">Tham gia: ${formatDate(user.createdAt)}</div></div></div>
              <div class="spacer"></div>
              <label class="muted">Đổi ảnh đại diện</label>
              ${avatarPicker(user.avatar)}
              <p class="muted compact-hide" style="font-size:12px">Cấp độ chỉ để thể hiện, không ảnh hưởng tới sức mạnh trong trận.</p>
            </div>
            <div class="card">
              <h2>📊 Thống kê</h2>
              <div class="grid profile-stats">
                ${stat(stats.matches, 'Số trận')}
                ${stat(stats.wins, 'Trận thắng')}
                ${stat(`${winRate}%`, 'Tỉ lệ thắng')}
                ${stat(stats.kills, 'Đã hạ')}
                ${stat((stats.kills / losses).toFixed(2), 'K/D')}
                ${stat(stats.bestDamage, 'Sát thương đỉnh')}
                ${stat(stats.avgPlacement ? `#${stats.avgPlacement.toFixed(1)}` : '—', 'Hạng TB')}
                ${stat(stats.avgSurvivalMs ? formatDuration(stats.avgSurvivalMs) : '—', 'Sống TB')}
                ${stat(stats.bestKills, 'Kỷ lục hạ')}
              </div>
            </div>
          </div>
          <div class="spacer"></div>
          <div class="card fill-card history-card" id="history-card"></div>
        </div></div>`);
      this.bindNav();
      this.renderHistory(history, 0);
      // swaps the avatar in place right away; the server answer only confirms it or rolls it back
      const showAvatar = (a: string) => {
        this.ui.querySelectorAll<HTMLElement>('[data-avatar]').forEach((x) => x.classList.toggle('active', x.dataset.avatar === a));
        this.ui.querySelectorAll('.avatar.lg, .player-chip .avatar').forEach((el) => (el.textContent = a));
      };
      let pending = 0;
      this.ui.querySelectorAll<HTMLElement>('[data-avatar]').forEach((b) =>
        b.addEventListener('click', async () => {
          if (b.classList.contains('active')) return;
          const seq = ++pending;
          showAvatar(b.dataset.avatar!);
          try {
            const res = await api.setAvatar(b.dataset.avatar!);
            if (seq !== pending) return;
            this.user = res.user;
            this.social.setMe(res.user);
          } catch (err) {
            if (seq === pending && this.screen === 'profile') showAvatar(this.user!.avatar);
            toast((err as Error).message, 'error');
          }
        }),
      );
    } catch (err) {
      if (this.screen === 'profile') this.loadFailed('Không tải được hồ sơ', err, () => this.showProfile());
    }
  }

  /** Fills the match history card on the profile screen; paging swaps only this card. */
  private renderHistory({ items, total }: { items: MatchHistoryEntry[]; total: number }, page: number) {
    const card = this.ui.querySelector<HTMLElement>('#history-card');
    if (!card) return;
    const rows = items
      .map((m) => `<tr>
        <td>${esc(formatDate(m.endedAt))}</td>
        <td>${esc(MODE_NAMES[m.mode])}${m.teamSize > 1 && isTeamSize(m.teamSize) ? ` · ${TEAM_SIZE_NAMES[m.teamSize]}` : ''}</td>
        <td>${m.mapId ? `${MAP_DEFS[m.mapId].icon} ${esc(MAP_DEFS[m.mapId].name)}` : '<span class="muted">—</span>'}</td>
        <td>${m.placement === 1 ? '🏆 ' : ''}${m.teamSize > 1 ? `Đội #${m.placement}` : `#${m.placement}/${m.playerCount}`}</td>
        <td>${m.kills}</td><td>${m.damage}</td>
        <td>${formatDuration(m.survivalMs)}</td><td>+${m.xpGained}</td></tr>`)
      .join('');
    const pages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
    card.innerHTML = `
      <h2>📜 Lịch sử trận đấu <span class="badge">${total} trận</span></h2>
      <p class="muted compact-hide">Chỉ lưu ${MATCH_HISTORY_KEEP} trận gần nhất, thống kê phía trên vẫn tính mọi trận đã chơi.</p>
      ${items.length ? `<div class="card-scroll ui-scroll"><table class="list nowrap">
        <thead><tr><th>Thời gian</th><th>Chế độ</th><th>Bản đồ</th><th>Hạng</th><th>Hạ gục</th><th>Sát thương</th><th>Sống sót</th><th>XP</th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : '<p class="muted">Bạn chưa chơi trận nào.</p>'}
      ${pages > 1 ? `<div class="spacer"></div>
      <div class="row between">
        <button class="btn small" data-page="${page - 1}" ${page <= 0 ? 'disabled' : ''}>← Trước</button>
        <span class="muted">Trang ${page + 1}/${pages}</span>
        <button class="btn small" data-page="${page + 1}" ${page + 1 >= pages ? 'disabled' : ''}>Sau →</button>
      </div>` : ''}`;
    card.querySelectorAll<HTMLButtonElement>('[data-page]').forEach((b) =>
      b.addEventListener('click', async () => {
        const next = Number(b.dataset.page);
        card.querySelectorAll<HTMLButtonElement>('[data-page]').forEach((x) => (x.disabled = true));
        try {
          const res = await api.history(HISTORY_PAGE_SIZE, next * HISTORY_PAGE_SIZE);
          if (this.screen === 'profile') this.renderHistory(res, next);
        } catch (err) {
          toast(`Không tải được lịch sử trận đấu: ${(err as Error).message}`, 'error');
          if (this.screen === 'profile') this.renderHistory({ items, total }, page);
        }
      }),
    );
  }

  // ---------------------------------------------------------------- leaderboard

  private async showRanks() {
    const kind = this.ranksKind;
    this.render('ranks', `
      <div class="screen fit"><div class="container">${this.header('ranks')}
        <div class="card fill-card ranks-card">
          <div class="ranks-head"><h2>🏆 Bảng xếp hạng</h2><p class="muted ranks-note" id="ranks-note"></p></div>
          <div class="diff-seg ranks-tabs" role="radiogroup" aria-label="Xếp hạng theo">
            ${LEADERBOARD_KINDS.map((k) => `<button type="button" role="radio" data-kind="${k}" aria-checked="${k === kind}" title="${LEADERBOARD_NAMES[k]}"><span aria-hidden="true">${RANK_ICONS[k]}</span><span>${RANK_TABS[k]}</span></button>`).join('')}
          </div>
          <div class="ranks-me" id="ranks-me"></div>
          <div class="card-scroll ui-scroll ranks-list" id="ranks-list"></div>
        </div>
      </div></div>`);
    this.bindNav();
    this.ui.querySelector('.ranks-tabs')!.addEventListener('click', (e) => {
      const k = (e.target as HTMLElement).closest<HTMLElement>('[data-kind]')?.dataset.kind;
      if (!isLeaderboardKind(k) || k === this.ranksKind) return;
      this.ranksKind = k;
      this.ui.querySelectorAll<HTMLElement>('.ranks-tabs [data-kind]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.kind === k)));
      void this.loadRanks(k);
    });
    await this.loadRanks(kind);
  }

  private async loadRanks(kind: LeaderboardKind) {
    const list = this.ui.querySelector<HTMLElement>('#ranks-list');
    if (!list) return;
    $('#ranks-note').textContent = RANK_NOTES[kind];
    const cached = this.ranksCache.get(kind);
    let board = cached && Date.now() - cached.at < RANKS_CACHE_MS ? cached.board : null;
    if (!board) {
      list.innerHTML = `<div class="ranks-wait">${walker('Đang tải bảng xếp hạng')}</div>`;
      $('#ranks-me').innerHTML = '';
      try {
        board = await api.leaderboard(kind);
        this.ranksCache.set(kind, { at: Date.now(), board });
      } catch (err) {
        if (this.screen === 'ranks' && this.ranksKind === kind) this.loadFailed('Không tải được bảng xếp hạng', err, () => void this.showRanks());
        return;
      }
    }
    // the player may have switched tab (or screen) while this board was loading
    if (this.screen !== 'ranks' || this.ranksKind !== kind) return;
    const meId = this.user?.id;
    list.innerHTML = board.entries.length
      ? board.entries.map((e) => rankRow(kind, e, e.id === meId)).join('')
      : '<p class="muted center ranks-empty">Chưa có ai trên bảng này. Chơi vài trận để giành chỗ đầu tiên!</p>';
    list.scrollTop = 0;
    // a top-3 player already sees their own (highlighted) row at the head of the list
    $('#ranks-me').innerHTML = !board.me
      ? `<p class="muted ranks-me-hint">${esc(rankEntryHint(kind, board))}</p>`
      : board.me.rank > 3 ? `<div class="ranks-me-label">Hạng của bạn</div>${rankRow(kind, board.me, true)}` : '';
  }

  // ---------------------------------------------------------------- admin: accounts

  private showAdmin() {
    if (!this.isAdmin) return this.showLobby();
    this.render('admin', `
      <div class="screen fit"><div class="container">${this.header('admin')}
        <div class="card fill-card admin-card">
          <div class="ranks-head"><h2>🛡️ Quản lý tài khoản</h2><p class="muted ranks-note" id="admin-note"></p></div>
          <form class="admin-search" role="search">
            <input class="input" name="q" maxlength="${NAME_MAX_LENGTH}" autocomplete="off" autocapitalize="off" spellcheck="false"
              placeholder="🔍 Tìm theo tên người chơi" aria-label="Tìm theo tên người chơi" value="${esc(this.adminQuery)}" />
          </form>
          <div class="card-scroll ui-scroll admin-list" id="admin-list"></div>
        </div>
      </div></div>`);
    this.bindNav();
    const form = this.ui.querySelector<HTMLFormElement>('.admin-search')!;
    const input = form.querySelector<HTMLInputElement>('input')!;
    let timer = 0;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => void this.loadAccounts(input.value.trim()), 300);
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      clearTimeout(timer);
      void this.loadAccounts(input.value.trim());
    });
    this.ui.querySelector('#admin-list')!.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-delete-account]')?.dataset.deleteAccount;
      const account = id && this.adminAccounts.find((a) => a.id === id);
      if (account) void this.deleteAccount(account);
    });
    void this.loadAccounts(this.adminQuery);
  }

  private async loadAccounts(q: string) {
    this.adminQuery = q;
    const seq = ++this.adminSeq;
    const list = this.ui.querySelector<HTMLElement>('#admin-list');
    const note = this.ui.querySelector<HTMLElement>('#admin-note');
    if (!list || !note) return;
    if (!/^[A-Za-z0-9_]*$/.test(q)) {
      list.innerHTML = '<p class="muted center ranks-empty">Tên người chơi chỉ gồm chữ không dấu, số và dấu _.</p>';
      note.textContent = '';
      return;
    }
    if (!this.adminAccounts.length) list.innerHTML = `<div class="ranks-wait">${walker('Đang tải danh sách tài khoản')}</div>`;
    try {
      const { accounts, total } = await api.adminAccounts(q);
      if (seq !== this.adminSeq || this.screen !== 'admin') return;
      this.adminAccounts = accounts;
      const shown = total > accounts.length ? ` · hiện ${accounts.length} tài khoản mới nhất` : '';
      note.textContent = q ? `${total} tài khoản có tên chứa “${q}”${shown}` : `Tổng ${total} tài khoản${shown}`;
      list.innerHTML = accounts.length
        ? accounts.map((a) => this.accountRow(a)).join('')
        : '<p class="muted center ranks-empty">Không tìm thấy tài khoản nào.</p>';
    } catch (err) {
      if (seq !== this.adminSeq || this.screen !== 'admin') return;
      list.innerHTML = `<p class="muted center ranks-empty">${esc((err as Error).message)}</p>`;
    }
  }

  private accountRow(a: AdminAccount): string {
    const seen = a.presence === 'offline' ? (a.lastLoginAt ? `Đăng nhập ${formatDate(a.lastLoginAt)}` : 'Chưa đăng nhập') : PRESENCE_LABELS[a.presence];
    const muted = a.mutedUntil ? ` · 🔇 đến ${formatDate(a.mutedUntil)}` : '';
    const deletable = !a.admin && a.id !== this.user?.id;
    return `<div class="ui-row admin-row">
      <span class="ui-avatar">${esc(a.avatar)}</span>
      <span class="ui-row-body">
        <b class="ui-row-title">${nameHtml(a.username, a.admin)} <span class="admin-presence" title="${PRESENCE_LABELS[a.presence]}">${PRESENCE_ICONS[a.presence]}</span></b>
        <small class="ui-row-sub">Cấp ${a.level} · ${a.matches} trận · Tạo ${formatDate(a.createdAt)}</small>
        <small class="ui-row-sub">${esc(seen)}${muted}</small>
      </span>
      <span class="ui-row-actions">${deletable
        ? `<button type="button" class="btn small danger" data-delete-account="${a.id}" aria-label="Xoá tài khoản ${esc(a.username)}">🗑️ Xoá</button>`
        : ''}</span>
    </div>`;
  }

  private async deleteAccount(a: AdminAccount) {
    const ok = await confirmDialog({
      title: `Xoá tài khoản ${a.username}?`,
      message: `Tài khoản bị xoá vĩnh viễn cùng cấp độ (cấp ${a.level}), lịch sử ${a.matches} trận, bạn bè và mọi tin nhắn; không khôi phục được.${a.presence === 'offline' ? '' : ' Người này đang online sẽ bị đưa ra khỏi trận và đăng xuất ngay.'}`,
      confirmText: 'Xoá vĩnh viễn',
      cancelText: 'Giữ lại',
      danger: true,
      typeToConfirm: a.username,
    });
    if (!ok) return;
    try {
      const name = await this.social.deleteUser(a.id);
      toast(`Đã xoá tài khoản ${name}.`);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
    if (this.screen === 'admin') await this.loadAccounts(this.adminQuery);
  }

  private showPanel(nav: PanelNav, title: string, body: string, bind?: (root: HTMLElement) => void) {
    this.panelNav = nav;
    this.render('panel', `
      <div class="screen fit"><div class="container">${this.header(nav)}
        <div class="card fill-card hug"><h2>${title}</h2><div class="card-scroll ui-scroll">${body}</div></div>
      </div></div>`);
    this.bindNav();
    bind?.(this.ui);
  }

  /**
   * The button editor page: a sketch of the match screen (so the player sees what a button would cover) with every
   * touch button on top to drag and resize. Saving or cancelling goes back to the page it was opened from.
   */
  private async showRoomQr(name: string, code: string, link: string) {
    if (this.closeQr || this.qrOpening) return;
    this.qrOpening = true;
    try {
      const close = await showQrDialog({
        title: 'Quét để vào phòng',
        subtitle: name,
        link,
        code,
        onCopy: () => void this.copyText(link, 'link mời'),
        onClose: () => {
          if (this.closeQr === close) this.closeQr = null;
        },
      });
      // the room closed or a match started while the QR library was loading
      if (this.screen !== 'room' || this.room?.id !== code) return close();
      this.closeQr = close;
    } catch (err) {
      toast(`Không tạo được mã QR: ${(err as Error).message}`, 'error');
    } finally {
      this.qrOpening = false;
    }
  }

  private async showControls() {
    if (this.layoutEditor || this.session || this.screen === 'controls') return;
    const from = this.screen;
    const panel = this.panelNav;
    const back = () => {
      if (from === 'panel') this.navTo(panel);
      else if (from === 'profile') this.showProfile();
      else this.showLobby();
    };
    const load = this.gameLoad;
    let Touch: typeof import('./game/Touch');
    try {
      Touch = await import('./game/Touch');
    } catch (err) {
      toast(`Không mở được trang chỉnh nút: ${(err as Error).message}`, 'error');
      return;
    }
    // a match started, the player signed out or moved on while the editor was loading
    if (load !== this.gameLoad || this.layoutEditor || this.session || !this.user || this.screen !== from) return;
    this.render('controls', `
      <div class="ctl-page" aria-hidden="true">
        <div class="ctl-zone left"><span>Vùng cần di chuyển</span></div>
        <div class="ctl-zone right"><span>Vùng cần xoay người</span></div>
        <div class="ctl-map"><span>Bản đồ nhỏ</span></div>
        <div class="ctl-me"></div>
        <div class="ctl-bottom"><div class="ctl-hp">100</div><div class="ctl-slots"><i></i><i></i><i></i><i></i></div></div>
      </div>`);
    const editor: TouchControls = new Touch.TouchControls(document.getElementById('touch')!, () => undefined, {
      preview: {
        onDone: () => {
          if (this.layoutEditor !== editor) return;
          this.layoutEditor = null;
          editor.destroy();
          back();
        },
      },
    });
    this.layoutEditor = editor;
  }

  /** Keeps what was arranged so far. */
  private closeLayoutEditor() {
    const editor = this.layoutEditor;
    this.layoutEditor = null;
    editor?.destroy();
  }
}
