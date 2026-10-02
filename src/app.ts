import type { Socket } from 'socket.io-client';
import {
  AVATARS,
  MAX_PLAYERS,
  MODE_NAMES,
  NAME_MAX_LENGTH,
  NAME_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  QUEUE_NOTICE_AFTER_MS,
  isUuid,
  levelFromXp,
  validatePassword,
  validateUsername,
  xpForLevel,
  type MatchStartMsg,
  type PublicUser,
  type QueueStatusMsg,
  type RoomStateMsg,
} from './shared';
import { ApiError, api, getToken, setToken } from './api';
import { unlockAudio } from './game/audio';
import { GameSession } from './game/session';
import { connectSocket, disconnectSocket } from './net';
import { $, esc, formatDate, formatDuration, toast } from './ui/dom';
import { NetStatus, SERVER_WAKING_TEXT } from './ui/netStatus';
import { bindSettings, guidePanel, itemsPanel, keysPanel, settingsPanel } from './ui/panels';
import { MODE_ICONS } from './ui/theme';

type Screen = 'loading' | 'auth' | 'lobby' | 'queue' | 'room' | 'profile' | 'history' | 'panel' | 'game' | 'message';

const PENDING_ROOM_KEY = 'br2d_pending_room';

export class App {
  private readonly ui = document.getElementById('ui')!;
  private user: PublicUser | null = null;
  private socket: Socket | null = null;
  private session: GameSession | null = null;
  private screen: Screen = 'loading';
  private queue: QueueStatusMsg | null = null;
  private queueSince = 0;
  private queueTimer = 0;
  private room: RoomStateMsg | null = null;
  private readonly net = new NetStatus();
  /** Set while a start/join request is in flight so repeated taps don't send it twice. */
  private pendingUntil = 0;

  async init() {
    const params = new URLSearchParams(location.search);
    const invite = params.get('room');
    if (invite && isUuid(invite)) sessionStorage.setItem(PENDING_ROOM_KEY, invite);
    if (invite) history.replaceState(null, '', location.pathname);

    this.render('loading', `<div class="screen"><div class="logo">BÁ KHÍ<span>TRỜI NAM 2D</span></div><div class="spinner"></div><p class="muted center" id="boot-hint"></p></div>`);
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
    if (arg === undefined) s.emit(event);
    else s.emit(event, arg);
    return true;
  }

  private clearPending() {
    this.pendingUntil = 0;
    document.body.classList.remove('net-pending');
  }

  private async copyText(text: string, label: string) {
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
    } catch {
      toast('Trình duyệt không cho phép sao chép, hãy chạm giữ vào mã để chép thủ công.', 'error', 4000);
    }
  }

  private loadFailed(title: string, err: unknown, retry: () => void) {
    this.render(this.screen, `<div class="screen"><div class="container">${this.header()}
      <div class="card center"><h2>${esc(title)}</h2><p class="muted">${esc((err as Error).message)}</p>
      <button class="btn primary" id="retry">Thử lại</button></div></div></div>`);
    this.bindNav();
    $('#retry').addEventListener('click', retry);
  }

  private render(screen: Screen, markup: string) {
    this.screen = screen;
    this.ui.innerHTML = markup;
    this.ui.classList.toggle('hidden', screen === 'game');
  }

  private showMessage(title: string, text: string, retry?: () => void) {
    this.render('message', `<div class="screen"><div class="narrow" style="margin-top:12vh"><div class="card center">
      <h2>${esc(title)}</h2><p class="muted">${esc(text)}</p>
      ${retry ? '<button class="btn primary" id="retry">Thử lại</button>' : ''}</div></div></div>`);
    if (retry) $('#retry').addEventListener('click', retry);
  }

  // ---------------------------------------------------------------- auth

  private showAuth(tab: 'login' | 'register') {
    const pendingRoom = sessionStorage.getItem(PENDING_ROOM_KEY);
    let avatar: string = AVATARS[Math.floor(Math.random() * AVATARS.length)];
    this.render('auth', `
      <div class="screen">
        <div class="logo-kicker">Huyền sử Văn Lang</div>
        <div class="logo">BÁ KHÍ<span>TRỜI NAM 2D</span></div>
        <div class="subtitle">Battle royale nhìn từ trên xuống · tối đa ${MAX_PLAYERS} người mỗi trận</div>
        <div class="narrow">
          ${pendingRoom ? '<div class="notice" style="margin-bottom:12px">Bạn được mời vào một phòng chơi. Hãy đăng nhập hoặc đăng ký để vào phòng.</div>' : ''}
          <div class="card">
            <div class="tabs">
              <button class="btn ${tab === 'login' ? 'active' : ''}" data-tab="login">Đăng nhập</button>
              <button class="btn ${tab === 'register' ? 'active' : ''}" data-tab="register">Đăng ký</button>
            </div>
            <form id="auth-form" autocomplete="on" novalidate>
              <div class="field"><label>Tên đăng nhập</label>
                <input class="input" name="username" maxlength="${NAME_MAX_LENGTH}" autocomplete="username" required /></div>
              ${tab === 'register' ? `<ul class="checklist" id="name-rules">
                <li data-rule="len">Từ ${NAME_MIN_LENGTH} đến ${NAME_MAX_LENGTH} ký tự</li>
                <li data-rule="chars">Bắt đầu bằng chữ cái, chỉ gồm chữ không dấu, số, dấu _</li>
              </ul>` : ''}
              <div class="field"><label>Mật khẩu</label>
                <input class="input" type="password" name="password" maxlength="${PASSWORD_MAX_LENGTH}" autocomplete="${tab === 'login' ? 'current-password' : 'new-password'}" required /></div>
              ${tab === 'register' ? `
                <ul class="checklist" id="pw-rules">
                  <li data-rule="len">Từ ${PASSWORD_MIN_LENGTH} đến ${PASSWORD_MAX_LENGTH} ký tự</li>
                  <li data-rule="upper">Có chữ in hoa (A-Z)</li>
                  <li data-rule="lower">Có chữ thường (a-z)</li>
                  <li data-rule="digit">Có chữ số (0-9)</li>
                  <li data-rule="special">Có ký tự đặc biệt (! @ # $ % ...)</li>
                  <li data-rule="space">Không có khoảng trắng</li>
                  <li data-rule="name">Không chứa tên đăng nhập</li>
                </ul>
                <div class="field"><label>Nhập lại mật khẩu</label>
                  <input class="input" type="password" name="confirm" maxlength="${PASSWORD_MAX_LENGTH}" autocomplete="new-password" required /></div>
                <div class="field"><label>Chọn ảnh đại diện</label>
                  <div class="avatar-picker">${AVATARS.map((a) => `<button type="button" data-avatar="${a}" class="${a === avatar ? 'active' : ''}">${a}</button>`).join('')}</div></div>` : ''}
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
        const res = tab === 'login' ? await api.login(username, password) : await api.register(username, password, avatar);
        setToken(res.token);
        this.onLoggedIn(res.user);
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
    this.connect();
    this.showLobby();
  }

  private logout() {
    setToken(null);
    this.session?.destroy();
    this.session = null;
    if (this.socket?.connected) {
      if (this.room) this.socket.emit('room:leave');
      if (this.queue?.inQueue) this.socket.emit('queue:leave');
    }
    disconnectSocket();
    this.socket = null;
    this.net.set('hidden');
    this.user = null;
    this.room = null;
    this.queue = null;
    this.clearPending();
    this.showAuth('login');
  }

  // ---------------------------------------------------------------- socket

  private connect() {
    if (this.socket) return;
    const s = connectSocket();
    this.socket = s;
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
    });
    s.on('disconnect', (reason) => {
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
      this.net.set(everConnected ? 'lost' : 'connecting', everConnected ? undefined : SERVER_WAKING_TEXT);
    });
    s.on('lobby:ready', () => {
      const pending = sessionStorage.getItem(PENDING_ROOM_KEY);
      if (pending) {
        sessionStorage.removeItem(PENDING_ROOM_KEY);
        s.emit('room:join', pending);
      }
      // the server only says "lobby" when we are no longer in a match, so a live session means it ended while we were away
      if (this.session && !this.session.isEnded) {
        this.session.destroy();
        this.session = null;
        toast('Trận đấu đã kết thúc trong lúc bạn mất kết nối.', 'error', 5000);
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
        if (this.screen === 'queue' || this.screen === 'lobby') this.showQueue();
      } else {
        this.queue = null;
        if (this.screen === 'queue') this.showLobby();
      }
    });
    s.on('room:state', (msg: RoomStateMsg) => {
      this.clearPending();
      this.room = msg;
      if (this.screen === 'room' || this.screen === 'lobby') this.showRoom();
    });
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
    s.on('session:replaced', () => {
      disconnectSocket();
      this.socket = null;
      this.net.set('hidden');
      this.session?.destroy();
      this.session = null;
      this.showMessage('Tài khoản đang được dùng ở nơi khác', 'Bạn vừa đăng nhập trên một thiết bị hoặc tab khác.', () => {
        this.connect();
        this.showLobby();
      });
    });
  }

  private startGame(msg: MatchStartMsg) {
    if (this.session && this.session.matchId === msg.matchId && !this.session.isEnded) {
      this.session.resync(msg);
      return;
    }
    this.session?.destroy();
    this.queue = null;
    this.room = null;
    window.clearInterval(this.queueTimer);
    this.render('game', '');
    this.session = new GameSession(msg, this.socket!, () => {
      this.session = null;
      this.showLobby();
      this.refreshUser();
    });
  }

  private refreshUser() {
    api.me().then(({ user }) => {
      this.user = user;
      if (this.screen === 'lobby') this.showLobby();
    }).catch(() => undefined);
  }

  // ---------------------------------------------------------------- lobby

  private header(inLobby = false): string {
    const u = this.user!;
    const level = levelFromXp(u.xp);
    const from = xpForLevel(level);
    const to = xpForLevel(level + 1);
    const pct = ((u.xp - from) / (to - from)) * 100;
    return `<div class="topbar">
      <div class="player-chip" data-nav="profile" title="Hồ sơ & thống kê">
        <span class="avatar">${esc(u.avatar)}</span>
        <div><div class="name">${esc(u.username)}</div>
          <div class="muted" style="font-size:12px">Cấp ${level} · ${u.xp - from}/${to - from} XP</div>
          <div class="xpbar"><div style="width:${pct}%"></div></div></div>
      </div>
      <div class="row topbar-actions">
        ${inLobby ? '' : '<button class="btn small" data-nav="lobby">🏠 Sảnh</button><button class="btn small" data-nav="settings" title="Cài đặt" aria-label="Cài đặt">⚙️</button>'}
        <button class="btn small" data-nav="logout">Đăng xuất</button>
      </div>
    </div>`;
  }

  private bindNav() {
    this.ui.querySelectorAll<HTMLElement>('[data-nav]').forEach((b) =>
      b.addEventListener('click', () => {
        unlockAudio();
        switch (b.dataset.nav) {
          case 'lobby': return this.showLobby();
          case 'logout': return this.logout();
          case 'profile': return this.showProfile();
          case 'history': return this.showHistory(0);
          case 'guide': return this.showPanel('📖 Hướng dẫn chơi', guidePanel());
          case 'items': return this.showPanel('🎒 Vật phẩm trong game', itemsPanel());
          case 'keys': return this.showPanel('⌨️ Phím tắt', keysPanel());
          case 'settings': return this.showPanel('⚙️ Cài đặt', settingsPanel(), bindSettings);
        }
      }),
    );
  }

  showLobby() {
    if (!this.user) return this.showAuth('login');
    if (this.queue?.inQueue) return this.showQueue();
    if (this.room) return this.showRoom();
    this.render('lobby', `
      <div class="screen"><div class="container lobby">
        ${this.header(true)}
        <div class="lobby-main">
          <div class="lobby-hero">
            <div class="logo-kicker">Huyền sử Văn Lang</div>
            <div class="logo">BÁ KHÍ<span>TRỜI NAM 2D</span></div>
            <div class="subtitle">Nhặt đồ, né bo, trụ lại đến cuối cùng</div>
          </div>
          <div class="modes">
            <div class="card mode-card" data-mode="pvp">
              <div class="icon">${MODE_ICONS.pvp}</div><h3>${MODE_NAMES.pvp}</h3>
              <p>Ghép trận tự động. Trận bắt đầu khi đủ ${MAX_PLAYERS} người chơi thật.</p>
              <span class="btn primary mode-cta">Tìm trận</span>
            </div>
            <div class="card mode-card" data-mode="bots">
              <div class="icon">${MODE_ICONS.bots}</div><h3>${MODE_NAMES.bots}</h3>
              <p>Vào trận ngay với ${MAX_PLAYERS - 1} bot. Phù hợp để luyện tập.</p>
              <span class="btn primary mode-cta">Chơi ngay</span>
            </div>
            <div class="card mode-card" data-mode="private">
              <div class="icon">${MODE_ICONS.private}</div><h3>${MODE_NAMES.private}</h3>
              <p>Tạo phòng và mời bạn bè bằng mã phòng hoặc đường link.</p>
              <button class="btn primary mode-cta" id="create-room">Tạo phòng</button>
              <div class="join-row">
                <input class="input" id="room-code" placeholder="Mã phòng / link mời" />
                <button class="btn" id="join-room">Vào</button>
              </div>
            </div>
          </div>
          <nav class="lobby-menu">
            <button class="menu-tile" data-nav="profile"><span>👤</span>Hồ sơ</button>
            <button class="menu-tile" data-nav="history"><span>📜</span>Lịch sử</button>
            <button class="menu-tile" data-nav="guide"><span>📖</span>Hướng dẫn</button>
            <button class="menu-tile" data-nav="items"><span>🎒</span>Vật phẩm</button>
            <button class="menu-tile" data-nav="keys"><span>⌨️</span>Phím tắt</button>
            <button class="menu-tile" data-nav="settings"><span>⚙️</span>Cài đặt</button>
          </nav>
        </div>
      </div></div>`);
    this.bindNav();
    this.ui.querySelector('[data-mode="pvp"]')!.addEventListener('click', () => {
      unlockAudio();
      this.send('queue:join', undefined, true);
    });
    this.ui.querySelector('[data-mode="bots"]')!.addEventListener('click', () => {
      unlockAudio();
      this.send('bot:start', undefined, true);
    });
    $('#create-room').addEventListener('click', (e) => {
      e.stopPropagation();
      this.send('room:create', undefined, true);
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

  // ---------------------------------------------------------------- queue

  private showQueue() {
    const q = this.queue!;
    const first = this.screen !== 'queue';
    if (first) {
      this.render('queue', `
        <div class="screen"><div class="container">${this.header()}
          <div class="narrow" style="margin-top:6vh"><div class="card center">
            <h2>⚔️ Đang tìm trận</h2>
            <div class="spinner"></div>
            <div class="logo" style="font-size:42px" id="q-count"></div>
            <p class="muted">Thời gian chờ: <b id="q-time">0:00</b></p>
            <div id="q-notice"></div>
            <div class="spacer"></div>
            <div class="menu-list">
              <button class="btn" id="q-bots">🤖 Chuyển sang đấu với bot</button>
              <button class="btn danger" id="q-cancel">Hủy tìm trận</button>
            </div>
          </div></div>
        </div></div>`);
      this.bindNav();
      $('#q-cancel').addEventListener('click', () => this.send('queue:leave'));
      $('#q-bots').addEventListener('click', () => {
        if (!this.send('queue:leave')) return;
        this.socket?.emit('bot:start');
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

  // ---------------------------------------------------------------- private room

  private showRoom() {
    const room = this.room!;
    const me = this.user!.id;
    const isHost = room.hostId === me;
    const link = `${location.origin}/?room=${room.id}`;
    const total = room.members.length;
    const members = room.members
      .map((m) => `
        <div class="member">
          <span class="avatar">${esc(m.avatar)}</span>
          <div class="grow"><b>${esc(m.name)}</b> ${m.id === room.hostId ? '<span class="badge gold">👑 Chủ phòng</span>' : ''} ${m.isBot ? '<span class="badge">BOT</span>' : ''} ${m.id === me ? '<span class="badge">Bạn</span>' : ''}
            <div class="muted" style="font-size:12px">Cấp ${m.level}</div></div>
          ${isHost && m.isBot ? `<button class="btn small" data-remove="${esc(m.id)}">Xóa</button>` : ''}
        </div>`)
      .join('');
    this.render('room', `
      <div class="screen"><div class="container">${this.header()}
        <div class="grid cols-2">
          <div class="card">
            <h2>👥 Phòng bạn bè</h2>
            <div class="field"><label>Mã phòng</label><div class="code">${esc(room.id)}</div></div>
            <div class="field"><label>Link mời</label><div class="code">${esc(link)}</div></div>
            <div class="row">
              <button class="btn" id="copy-code">📋 Sao chép mã</button>
              <button class="btn" id="copy-link">🔗 Sao chép link mời</button>
            </div>
            <p class="muted">Gửi mã hoặc link cho bạn bè. Người chưa có tài khoản sẽ được yêu cầu đăng ký rồi tự vào phòng.</p>
          </div>
          <div class="card">
            <div class="row between"><h2>Người chơi (${total}/${room.max})</h2></div>
            <div class="grid">${members}</div>
            <div class="spacer"></div>
            ${isHost ? `
              <div class="row">
                <button class="btn" id="add-bot" ${total >= room.max ? 'disabled' : ''}>🤖 Thêm bot</button>
                <button class="btn" id="fill-bots" ${total >= room.max ? 'disabled' : ''}>Thêm bot cho đủ ${room.max}</button>
              </div>
              <div class="spacer"></div>
              <button class="btn primary big block" id="start-room" ${total < room.min ? 'disabled' : ''}>▶ Bắt đầu (${total}/${room.max})</button>
              ${total < room.min ? `<p class="muted center">Cần ít nhất ${room.min} người (có thể thêm bot).</p>` : ''}`
              : '<p class="center muted">Đang chờ chủ phòng bắt đầu trận…</p>'}
            <div class="spacer"></div>
            <button class="btn danger block" id="leave-room">Rời phòng</button>
          </div>
        </div>
      </div></div>`);
    this.bindNav();
    $('#copy-code').addEventListener('click', () => void this.copyText(room.id, 'mã phòng'));
    $('#copy-link').addEventListener('click', () => void this.copyText(link, 'link mời'));
    $('#leave-room').addEventListener('click', () => this.send('room:leave'));
    if (isHost) {
      $('#add-bot').addEventListener('click', () => this.send('room:addBot'));
      $('#fill-bots').addEventListener('click', () => {
        if (!this.send('room:addBot')) return;
        for (let i = total + 1; i < room.max; i++) this.socket?.emit('room:addBot');
      });
      $('#start-room').addEventListener('click', () => {
        unlockAudio();
        this.send('room:start', undefined, true);
      });
      this.ui.querySelectorAll<HTMLElement>('[data-remove]').forEach((b) =>
        b.addEventListener('click', () => this.send('room:removeBot', b.dataset.remove)),
      );
    }
  }

  // ---------------------------------------------------------------- profile & history

  private async showProfile() {
    this.render('profile', `<div class="screen"><div class="container">${this.header()}<div class="card"><div class="spinner"></div></div></div></div>`);
    this.bindNav();
    try {
      const [{ user }, { stats }] = await Promise.all([api.me(), api.stats()]);
      this.user = user;
      if (this.screen !== 'profile') return;
      const level = levelFromXp(user.xp);
      const from = xpForLevel(level);
      const to = xpForLevel(level + 1);
      const losses = Math.max(1, stats.matches - stats.wins);
      const winRate = stats.matches ? ((stats.wins / stats.matches) * 100).toFixed(1) : '0';
      const stat = (v: string | number, l: string) => `<div class="stat"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`;
      this.render('profile', `
        <div class="screen"><div class="container">${this.header()}
          <div class="grid cols-2">
            <div class="card">
              <h2>👤 Thông tin nhân vật</h2>
              <div class="row"><span class="avatar lg">${esc(user.avatar)}</span>
                <div><h3 style="margin:0">${esc(user.username)}</h3>
                  <div class="muted">Cấp ${level} · ${user.xp} XP tổng</div>
                  <div class="xpbar" style="width:200px;margin-top:6px"><div style="width:${((user.xp - from) / (to - from)) * 100}%"></div></div>
                  <div class="muted" style="font-size:12px">Còn ${to - user.xp} XP để lên cấp ${level + 1}</div>
                  <div class="muted" style="font-size:12px">Tham gia: ${formatDate(user.createdAt)}</div></div></div>
              <div class="spacer"></div>
              <label class="muted">Đổi ảnh đại diện</label>
              <div class="avatar-picker">${AVATARS.map((a) => `<button data-avatar="${a}" class="${a === user.avatar ? 'active' : ''}">${a}</button>`).join('')}</div>
              <p class="muted" style="font-size:12px">Cấp độ chỉ để thể hiện, không ảnh hưởng tới sức mạnh trong trận.</p>
            </div>
            <div class="card">
              <h2>📊 Thống kê</h2>
              <div class="grid cols-4">
                ${stat(stats.matches, 'Số trận')}
                ${stat(stats.wins, 'Trận thắng')}
                ${stat(`${winRate}%`, 'Tỉ lệ thắng')}
                ${stat(stats.kills, 'Người đã hạ')}
                ${stat((stats.kills / losses).toFixed(2), 'K/D')}
                ${stat(stats.damage, 'Sát thương gây ra')}
                ${stat(stats.avgPlacement ? `#${stats.avgPlacement.toFixed(1)}` : '—', 'Thứ hạng TB')}
                ${stat(stats.avgSurvivalMs ? formatDuration(stats.avgSurvivalMs) : '—', 'Thời gian sống TB')}
                ${stat(formatDuration(stats.totalSurvivalMs), 'Tổng thời gian sống')}
                ${stat(stats.bestKills, 'Hạ nhiều nhất / trận')}
              </div>
            </div>
          </div>
        </div></div>`);
      this.bindNav();
      this.ui.querySelectorAll<HTMLElement>('[data-avatar]').forEach((b) =>
        b.addEventListener('click', async () => {
          try {
            const res = await api.setAvatar(b.dataset.avatar!);
            this.user = res.user;
            this.showProfile();
          } catch (err) {
            toast((err as Error).message, 'error');
          }
        }),
      );
    } catch (err) {
      if (this.screen === 'profile') this.loadFailed('Không tải được hồ sơ', err, () => this.showProfile());
    }
  }

  private async showHistory(page: number) {
    const limit = 15;
    this.render('history', `<div class="screen"><div class="container">${this.header()}<div class="card"><div class="spinner"></div></div></div></div>`);
    this.bindNav();
    try {
      const { items, total } = await api.history(limit, page * limit);
      if (this.screen !== 'history') return;
      const rows = items
        .map((m) => `<tr>
          <td>${esc(formatDate(m.endedAt))}</td>
          <td>${esc(MODE_NAMES[m.mode])}</td>
          <td>${m.placement === 1 ? '🏆 ' : ''}#${m.placement}/${m.playerCount}</td>
          <td>${m.kills}</td><td>${m.damage}</td>
          <td>${formatDuration(m.survivalMs)}</td><td>+${m.xpGained}</td></tr>`)
        .join('');
      const pages = Math.max(1, Math.ceil(total / limit));
      this.render('history', `
        <div class="screen"><div class="container">${this.header()}
          <div class="card">
            <h2>📜 Lịch sử trận đấu (${total} trận)</h2>
            ${items.length ? `<div class="table-wrap"><table class="list">
              <thead><tr><th>Thời gian</th><th>Chế độ</th><th>Hạng</th><th>Hạ gục</th><th>Sát thương</th><th>Sống sót</th><th>XP</th></tr></thead>
              <tbody>${rows}</tbody></table></div>` : '<p class="muted">Bạn chưa chơi trận nào.</p>'}
            <div class="spacer"></div>
            <div class="row between">
              <button class="btn small" id="prev" ${page <= 0 ? 'disabled' : ''}>← Trước</button>
              <span class="muted">Trang ${page + 1}/${pages}</span>
              <button class="btn small" id="next" ${page + 1 >= pages ? 'disabled' : ''}>Sau →</button>
            </div>
          </div>
        </div></div>`);
      this.bindNav();
      $('#prev').addEventListener('click', () => this.showHistory(page - 1));
      $('#next').addEventListener('click', () => this.showHistory(page + 1));
    } catch (err) {
      if (this.screen === 'history') this.loadFailed('Không tải được lịch sử trận đấu', err, () => this.showHistory(page));
    }
  }

  private showPanel(title: string, body: string, bind?: (root: HTMLElement) => void) {
    this.render('panel', `
      <div class="screen"><div class="container">${this.header()}
        <div class="card"><h2>${title}</h2>${body}</div>
      </div></div>`);
    this.bindNav();
    bind?.(this.ui);
  }
}
