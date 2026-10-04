import {
  CHAT_MAX_LENGTH,
  MUTE_OPTIONS,
  PRESENCE_LABELS,
  SUPPORT_KEY,
  USER_SEARCH_MIN,
  WORLD_CHANNEL,
  type ChatMessage,
  type FriendEntry,
  type SocialUser,
  type UserSearchResult,
} from '../shared';
import { choiceDialog, confirmDialog, esc, html, toast } from '../ui/dom';
import { adminBadge, nameHtml } from '../ui/names';
import { threadKey, type ConvoKey, type SocialChange, type SocialClient } from './SocialClient';
import './social.css';

/** `support` is a player's chat with the admins, or an admin's inbox; `thread` is an admin answering one player. */
type View =
  | { kind: 'world' }
  | { kind: 'friends' }
  | { kind: 'dm'; peer: string }
  | { kind: 'support' }
  | { kind: 'thread'; user: SocialUser };
type Tab = 'world' | 'friends' | 'support';

/** Wide enough for the drawer to stay open by default without hiding most of the page. */
const WIDE_QUERY = '(min-width: 1200px)';
const GROUP_WINDOW_MS = 3 * 60 * 1000;
const NEAR_BOTTOM_PX = 80;

const count = (n: number) => (n > 0 ? `<span class="ui-count">${n > 99 ? '99+' : n}</span>` : '');
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const t = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? t : `${d.getDate()}/${d.getMonth() + 1} ${t}`;
}

interface RowOptions {
  user: SocialUser;
  sub?: string;
  status?: FriendEntry['presence'];
  badge?: number;
  actions?: string;
  attrs?: string;
}

/** Generic list row (avatar, two text lines, trailing actions), shared by every social list. */
function row({ user, sub, status, badge = 0, actions = '', attrs = '' }: RowOptions): string {
  return `<div class="ui-row" ${attrs}>
    <span class="ui-avatar">${esc(user.avatar)}${status ? `<i class="ui-dot" data-status="${status}"></i>` : ''}</span>
    <span class="ui-row-body"><b class="ui-row-title">${nameHtml(user.username, user.admin)}</b><small class="ui-row-sub">${sub ?? `Cấp ${user.level}`}</small></span>
    ${count(badge)}
    <span class="ui-row-actions">${actions}</span>
  </div>`;
}

/** Floating chat button plus the drawer holding world chat, friends and direct messages. */
export class SocialPanel {
  private readonly fab: HTMLButtonElement;
  private readonly drawer: HTMLElement;
  private readonly body: HTMLElement;
  private view: View = { kind: 'world' };
  private open = false;
  private allowed = false;
  /** Set by the close button: the panel then stays shut until reopened, instead of popping up on every screen. */
  private userClosed = false;
  private readonly wide = matchMedia(WIDE_QUERY);
  private list: HTMLElement | null = null;
  private lastRendered: ChatMessage | null = null;
  private keepScrollFrom: number | null = null;
  private searchTimer = 0;
  private searchSeq = 0;
  private searchResults: UserSearchResult[] = [];

  constructor(private readonly client: SocialClient) {
    this.fab = html(`<button class="social-fab ui-iconbtn lg" type="button" aria-label="Chat và bạn bè" title="Chat và bạn bè">
      <span aria-hidden="true">💬</span><span class="social-fab-count"></span></button>`) as HTMLButtonElement;
    this.drawer = html(`<aside class="social-drawer ui-panel" role="dialog" aria-label="Chat và bạn bè">
      <header class="social-head">
        <div class="ui-seg" role="tablist">
          <button type="button" role="tab" data-tab="world">🌏 Thế giới<span data-count="world"></span></button>
          <button type="button" role="tab" data-tab="friends">👥 Bạn bè<span data-count="friends"></span></button>
          <button type="button" role="tab" data-tab="support"><span data-label="support"></span><span data-count="support"></span></button>
        </div>
        <button type="button" class="ui-iconbtn" data-act="close" aria-label="Đóng" title="Đóng (Esc)">✕</button>
      </header>
      <div class="social-body"></div>
    </aside>`);
    this.body = this.drawer.querySelector('.social-body')!;
    document.body.append(this.fab, this.drawer);

    this.fab.addEventListener('click', () => {
      this.userClosed = false;
      this.toggle(true);
    });
    this.drawer.querySelector('[data-act="close"]')!.addEventListener('click', () => {
      this.userClosed = true;
      this.toggle(false);
    });
    this.drawer.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => this.go({ kind: b.dataset.tab as Tab })),
    );
    // on wide screens it stays open while the page is used; only the close button shuts it
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open && !this.wide.matches) this.toggle(false);
    });
    // pointerdown, not click: inner re-renders can detach the target before click fires
    document.addEventListener('pointerdown', (e) => {
      if (!this.open || this.wide.matches || !(e.target instanceof Node)) return;
      if (this.drawer.contains(e.target) || this.fab.contains(e.target)) return;
      // the drawer's own dialogs (mute, delete, unfriend) sit outside it in the DOM
      if (e.target instanceof Element && e.target.closest('.confirm-modal')) return;
      this.toggle(false);
    });
    this.wide.addEventListener('change', () => {
      if (this.wide.matches) this.autoOpen();
      else this.toggle(false);
      this.sync();
    });
    client.subscribe((c) => this.onChange(c));
    this.sync();
  }

  /** Shown on menu screens only; messages keep counting while hidden. */
  setAllowed(allowed: boolean) {
    this.allowed = allowed;
    if (!allowed) this.toggle(false);
    else this.autoOpen();
    this.sync();
  }

  reset() {
    this.toggle(false);
    this.userClosed = false;
    this.view = { kind: 'world' };
    this.body.innerHTML = '';
    this.list = null;
    this.sync();
  }

  /** Open by default on wide screens; on narrow ones the drawer would cover nearly everything. */
  private autoOpen() {
    if (this.allowed && this.wide.matches && !this.userClosed) this.toggle(true, false);
  }

  private toggle(open: boolean, focus = true) {
    if (open === this.open) return;
    this.open = open && this.allowed;
    if (this.open) this.go(this.view, focus);
    else this.client.viewing = null;
    this.sync();
  }

  private go(view: View, focus = true) {
    this.view = view;
    this.list = null;
    const key = this.currentKey;
    if (view.kind === 'friends') this.renderFriendsView();
    else if (key) this.renderChatView(key, focus);
    else this.renderInboxView();
    this.client.viewing = key;
    if (key) this.client.markViewed(key);
    // admin presence and the inbox are not pushed, so refresh them whenever the support tab is opened
    if (view.kind === 'support' || view.kind === 'thread') void this.client.loadSupport();
    this.sync();
  }

  private get currentKey(): ConvoKey | null {
    switch (this.view.kind) {
      case 'world': return WORLD_CHANNEL;
      case 'dm': return this.view.peer;
      case 'support': return this.client.isAdmin ? null : SUPPORT_KEY;
      case 'thread': return threadKey(this.view.user.id);
      default: return null;
    }
  }

  private get tab(): Tab {
    const k = this.view.kind;
    return k === 'world' ? 'world' : k === 'support' || k === 'thread' ? 'support' : 'friends';
  }

  /** Badges, tab state and visibility. */
  private sync() {
    const c = this.client;
    const total = c.unreadTotal;
    this.fab.hidden = !this.allowed || this.open;
    this.drawer.classList.toggle('open', this.open);
    this.drawer.setAttribute('aria-hidden', String(!this.open));    this.fab.querySelector('.social-fab-count')!.innerHTML = count(total);
    this.drawer.querySelector('[data-count="world"]')!.innerHTML = count(c.worldUnread);
    this.drawer.querySelector('[data-count="friends"]')!.innerHTML = count(c.dmUnread + c.state.incoming.length);
    this.drawer.querySelector('[data-count="support"]')!.innerHTML = count(c.supportBadge);
    this.drawer.querySelector('[data-label="support"]')!.textContent = c.isAdmin ? '🛡️ Hộp thư' : '🛡️ Admin';
    const tab = this.tab;
    this.drawer.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === tab);
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    });
  }

  private onChange(change: SocialChange) {
    switch (change.type) {
      case 'message':
        if (this.open && change.key === this.currentKey) this.appendMessage(change.message);
        else this.notify(change.key, change.message);
        break;
      case 'history':
        if (this.open && change.key === this.currentKey) this.renderMessages();
        if (change.key === this.client.viewing) this.client.markViewed(change.key);
        break;
      case 'friends':
        if (this.allowed) for (const name of change.newIncoming) toast(`👋 ${name} muốn kết bạn với bạn`);
        if (this.view.kind === 'dm' && !this.client.friend(this.view.peer)) {
          if (this.open) toast('Hai bạn không còn là bạn bè.', 'error');
          this.view = { kind: 'friends' };
          if (this.open) this.go(this.view);
        }
        this.refreshFriendBits();
        break;
      case 'presence':
      case 'unread':
        this.refreshFriendBits();
        if (change.type === 'unread') this.refreshSupportBits();
        break;
      case 'support':
        this.refreshSupportBits();
        break;
      case 'muted':
        if (change.until && change.auto) toast(`🔇 Bạn bị tự động cấm chat đến ${timeLabel(change.until)} vì dùng từ ngữ không phù hợp nhiều lần. Bạn vẫn nhắn được cho quản trị viên ở tab 🛡️ Admin.`, 'error', 8000);
        else if (change.until) toast(`🔇 Bạn bị quản trị viên cấm chat đến ${timeLabel(change.until)}. Bạn vẫn nhắn được cho quản trị viên ở tab 🛡️ Admin.`, 'error', 8000);
        else toast('Bạn đã được quản trị viên bỏ cấm chat.', 'info', 5000);
        break;
    }
    this.sync();
  }

  private notify(key: ConvoKey, m: ChatMessage) {
    if (!this.allowed || key === WORLD_CHANNEL || m.from.id === this.client.me?.id) return;
    const support = key === SUPPORT_KEY || key.startsWith('support:');
    toast(`${support ? '🛡️' : '💬'} ${m.from.username}: ${clip(m.text, 60)}`);
  }

  /** Redraws the parts of the open view that depend on support state. */
  private refreshSupportBits() {
    if (!this.open) return;
    if (this.view.kind === 'support') {
      if (this.client.isAdmin) this.renderInboxList();
      else this.renderSupportHint();
    } else if (this.view.kind === 'thread') {
      this.renderThreadHeader();
    }
  }

  /** Redraws the parts of the open view that depend on the friends list. */
  private refreshFriendBits() {
    if (!this.open) return;
    if (this.view.kind === 'friends') this.renderFriendLists();
    else if (this.view.kind === 'dm') this.renderDmHeader();
  }

  // ---------------------------------------------------------------- chat views

  private renderChatView(key: ConvoKey, focus = true) {
    const view = this.view;
    const kind = view.kind;
    const head = kind === 'world'
      ? '<div class="chat-hint">Kênh chung cho mọi người chơi · tối đa 1 tin mỗi 2 giây</div>'
      : kind === 'support' ? '<div class="chat-hint support-hint"></div>' : '<div class="chat-peer"></div>';
    const placeholder = view.kind === 'world' ? 'Nhắn cho mọi người…'
      : view.kind === 'support' ? 'Nhắn cho quản trị viên…'
      : view.kind === 'thread' ? `Trả lời ${view.user.username}…` : 'Nhắn riêng…';
    this.body.innerHTML = `
      ${head}
      <div class="chat-list ui-scroll" aria-live="polite"></div>
      <button type="button" class="chat-newpill" hidden>Tin mới ↓</button>
      <form class="chat-composer">
        <input class="input" name="text" maxlength="${CHAT_MAX_LENGTH}" autocomplete="off" enterkeyhint="send"
          placeholder="${esc(placeholder)}" aria-label="Nội dung tin nhắn" />
        <button class="btn primary small" type="submit">Gửi</button>
      </form>`;
    this.list = this.body.querySelector('.chat-list');
    if (kind === 'dm') this.renderDmHeader();
    else if (kind === 'support') this.renderSupportHint();
    else if (kind === 'thread') this.renderThreadHeader();

    const form = this.body.querySelector<HTMLFormElement>('.chat-composer')!;
    const input = form.querySelector<HTMLInputElement>('input')!;
    const pill = this.body.querySelector<HTMLButtonElement>('.chat-newpill')!;
    pill.addEventListener('click', () => this.scrollToBottom());
    this.list!.addEventListener('scroll', () => {
      if (this.isNearBottom()) pill.hidden = true;
    });
    this.list!.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('.chat-older')) return this.loadOlder(key);
      const name = t.closest<HTMLElement>('[data-user]')?.dataset.user;
      if (name && name !== this.client.me?.username) this.findUser(name);
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      const button = form.querySelector<HTMLButtonElement>('button')!;
      button.disabled = true;
      try {
        const warn = await this.client.send(key, text);
        input.value = '';
        if (warn) toast(`⚠️ ${warn}`, 'error', 6000);
      } catch (err) {
        toast((err as Error).message, 'error');
      } finally {
        button.disabled = false;
        input.focus();
      }
    });

    const convo = this.client.convo(key);
    this.renderMessages();
    // while still connecting, the reconnect handler loads every open conversation
    if (!convo.loaded) this.client.loadHistory(key).catch((err) => this.client.connected && toast((err as Error).message, 'error'));
    if (focus && matchMedia('(pointer: fine)').matches) input.focus();
  }

  private renderDmHeader() {
    if (this.view.kind !== 'dm') return;
    const box = this.body.querySelector<HTMLElement>('.chat-peer');
    const f = this.client.friend(this.view.peer);
    if (!box || !f) return;
    box.innerHTML = `
      <button type="button" class="ui-iconbtn" data-act="back" aria-label="Quay lại danh sách bạn bè" title="Quay lại">←</button>
      ${row({ user: f, status: f.presence, sub: PRESENCE_LABELS[f.presence] })}
      <button type="button" class="ui-iconbtn danger" data-act="unfriend" aria-label="Huỷ kết bạn" title="Huỷ kết bạn">✕</button>`;
    box.querySelector('[data-act="back"]')!.addEventListener('click', () => this.go({ kind: 'friends' }));
    box.querySelector('[data-act="unfriend"]')!.addEventListener('click', () => this.unfriend(f));
  }

  private renderSupportHint() {
    const box = this.body.querySelector<HTMLElement>('.support-hint');
    if (!box) return;
    box.classList.toggle('online', this.client.adminOnline);
    box.textContent = this.client.adminOnline
      ? '🟢 Có quản trị viên đang trực tuyến · tin nhắn được gửi tới mọi quản trị viên'
      : '⚪ Chưa có quản trị viên trực tuyến · cứ để lại lời nhắn, quản trị viên sẽ trả lời sau';
  }

  private renderThreadHeader() {
    if (this.view.kind !== 'thread') return;
    const box = this.body.querySelector<HTMLElement>('.chat-peer');
    if (!box) return;
    const user = this.view.user;
    const presence = this.client.thread(user.id)?.presence;
    box.innerHTML = `
      <button type="button" class="ui-iconbtn" data-act="back" aria-label="Quay lại hộp thư" title="Quay lại">←</button>
      ${row({ user, status: presence, sub: `${presence ? `${PRESENCE_LABELS[presence]} · ` : ''}Cấp ${user.level} · Hỗ trợ người chơi` })}`;
    box.querySelector('[data-act="back"]')!.addEventListener('click', () => this.go({ kind: 'support' }));
  }

  // ---------------------------------------------------------------- admin inbox

  private renderInboxView() {
    this.body.innerHTML = `
      <div class="chat-hint">Tin nhắn hỗ trợ từ người chơi · mọi quản trị viên đều thấy và trả lời được</div>
      <div class="friends-view ui-scroll"><div class="inbox-list"></div></div>`;
    const view = this.body.querySelector<HTMLElement>('.friends-view')!;
    const open = (el: HTMLElement | null) => {
      const t = el && this.client.thread(el.dataset.openThread!);
      if (t) this.go({ kind: 'thread', user: t.user });
    };
    view.addEventListener('click', (e) => open((e.target as HTMLElement).closest<HTMLElement>('[data-open-thread]')));
    view.addEventListener('keydown', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-open-thread]');
      if (el && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        open(el);
      }
    });
    this.renderInboxList();
  }

  private renderInboxList() {
    const box = this.body.querySelector<HTMLElement>('.inbox-list');
    if (!box) return;
    const { inbox, inboxLoaded } = this.client;
    if (!inbox.length) {
      box.innerHTML = `<div class="ui-empty">${inboxLoaded ? 'Chưa có người chơi nào nhắn hỗ trợ. Muốn nhắn trước cho ai, hãy tìm tên họ ở tab Bạn bè.' : 'Đang tải…'}</div>`;
      return;
    }
    box.innerHTML = inbox.map((t) => row({
      user: t.user,
      status: t.presence,
      sub: `${t.last.fromAdmin ? '🛡️ ' : ''}${esc(clip(t.last.text, 40))} · ${timeLabel(t.last.at)}`,
      badge: t.unread,
      attrs: `data-open-thread="${t.user.id}" role="button" tabindex="0"`,
      actions: '<span class="ui-row-chevron" aria-hidden="true">›</span>',
    })).join('');
  }

  private renderMessages() {
    const list = this.list;
    const key = this.currentKey;
    if (!list || !key) return;
    const convo = this.client.convo(key);
    const oldHeight = list.scrollHeight;
    this.lastRendered = null;
    list.innerHTML = convo.hasOlder ? '<button type="button" class="chat-older">Xem tin cũ hơn</button>' : '';
    if (!convo.messages.length) {
      const empty = key === WORLD_CHANNEL ? 'Chưa có ai lên tiếng. Chào mọi người một câu nhé!'
        : key === SUPPORT_KEY ? 'Cần hỗ trợ gì? Gửi tin nhắn, quản trị viên sẽ trả lời ngay tại đây.'
        : this.view.kind === 'thread' ? 'Chưa có tin nhắn nào với người chơi này.' : 'Hãy gửi lời chào đầu tiên.';
      list.insertAdjacentHTML('beforeend', `<div class="ui-empty">${convo.loaded ? empty : 'Đang tải…'}</div>`);
    }
    const frag = document.createDocumentFragment();
    for (const m of convo.messages) frag.append(this.messageEl(m));
    list.append(frag);
    if (this.keepScrollFrom !== null) {
      list.scrollTop = list.scrollHeight - oldHeight + this.keepScrollFrom;
      this.keepScrollFrom = null;
    } else {
      this.scrollToBottom();
    }
  }

  private appendMessage(m: ChatMessage) {
    const list = this.list;
    if (!list) return;
    const stick = this.isNearBottom() || m.from.id === this.client.me?.id;
    list.querySelector('.ui-empty')?.remove();
    list.append(this.messageEl(m));
    while (list.childElementCount > 220) list.firstElementChild?.remove();
    if (stick) this.scrollToBottom();
    else (this.body.querySelector('.chat-newpill') as HTMLElement).hidden = false;
  }

  private messageEl(m: ChatMessage): HTMLElement {
    const mine = m.from.id === this.client.me?.id;
    const prev = this.lastRendered;
    const grouped = !!prev && prev.from.id === m.from.id && Date.parse(m.at) - Date.parse(prev.at) < GROUP_WINDOW_MS;
    this.lastRendered = m;
    const showName = !mine && this.view.kind !== 'dm';
    const admin = m.from.admin === true;
    const el = html(`<div class="chat-msg${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}${admin ? ' admin' : ''}">
      ${mine ? '' : `<span class="ui-avatar sm">${grouped ? '' : esc(m.from.avatar)}</span>`}
      <div class="chat-bubble">
        ${grouped ? '' : `<div class="chat-meta">${showName ? `<button type="button" class="chat-name" data-user="${esc(m.from.username)}" title="Tìm để kết bạn">${nameHtml(m.from.username, admin, false)}</button><span class="chat-lv">Cấp ${m.from.level}</span>` : ''}${admin ? adminBadge() : ''}<time datetime="${esc(m.at)}">${timeLabel(m.at)}</time></div>`}
        <div class="chat-text">${esc(m.text)}</div>
        ${m.raw ? '<button type="button" class="chat-raw" aria-pressed="false" title="Chỉ quản trị viên thấy: nội dung trước khi bộ lọc che">🛡️ Xem gốc</button>' : ''}
      </div>
    </div>`);
    const rawBtn = el.querySelector<HTMLButtonElement>('.chat-raw');
    rawBtn?.addEventListener('click', () => {
      const showRaw = rawBtn.getAttribute('aria-pressed') !== 'true';
      rawBtn.setAttribute('aria-pressed', String(showRaw));
      rawBtn.textContent = showRaw ? '🛡️ Ẩn gốc' : '🛡️ Xem gốc';
      el.querySelector('.chat-text')!.textContent = showRaw ? m.raw! : m.text;
    });
    return el;
  }

  private isNearBottom(): boolean {
    const l = this.list;
    return !l || l.scrollHeight - l.scrollTop - l.clientHeight < NEAR_BOTTOM_PX;
  }

  private scrollToBottom() {
    const l = this.list;
    if (l) l.scrollTop = l.scrollHeight;
    const pill = this.body.querySelector<HTMLElement>('.chat-newpill');
    if (pill) pill.hidden = true;
  }

  private loadOlder(key: ConvoKey) {
    const l = this.list;
    if (!l) return;
    this.keepScrollFrom = l.scrollTop;
    this.client.loadHistory(key, true).catch((err) => {
      this.keepScrollFrom = null;
      toast((err as Error).message, 'error');
    });
  }

  // ---------------------------------------------------------------- friends view

  private renderFriendsView() {
    this.body.innerHTML = `
      <div class="friends-view ui-scroll">
        <form class="friend-search" role="search">
          <input class="input" name="q" maxlength="16" autocomplete="off" placeholder="🔍 Tìm tên người chơi để kết bạn" aria-label="Tìm người chơi" />
        </form>
        <div class="search-results"></div>
        <div class="friend-lists"></div>
      </div>`;
    const form = this.body.querySelector<HTMLFormElement>('.friend-search')!;
    const input = form.querySelector('input')!;
    input.addEventListener('input', () => {
      clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => this.runSearch(input.value), 250);
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      clearTimeout(this.searchTimer);
      this.runSearch(input.value);
    });
    const view = this.body.querySelector<HTMLElement>('.friends-view')!;
    view.addEventListener('click', (e) => this.onFriendAction(e));
    view.addEventListener('keydown', (e) => {
      const rowEl = (e.target as HTMLElement).closest<HTMLElement>('.ui-row[data-open-dm]');
      if (rowEl && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        this.go({ kind: 'dm', peer: rowEl.dataset.openDm! });
      }
    });
    this.renderFriendLists();
  }

  private renderFriendLists() {
    const box = this.body.querySelector<HTMLElement>('.friend-lists');
    if (!box) return;
    const { friends, incoming, outgoing } = this.client.state;
    const online = friends.filter((f) => f.presence !== 'offline').length;
    const section = (title: string, rows: string) => `<section><h4 class="ui-section-title">${title}</h4>${rows}</section>`;
    box.innerHTML = [
      incoming.length
        ? section(`Lời mời kết bạn · ${incoming.length}`, incoming.map((u) => row({
          user: u,
          actions: `<button type="button" class="btn primary small" data-accept="${u.id}">Đồng ý</button>
            <button type="button" class="ui-iconbtn" data-decline="${u.id}" aria-label="Từ chối" title="Từ chối">✕</button>`,
        })).join(''))
        : '',
      section(`Bạn bè · ${online}/${friends.length} trực tuyến`, friends.length
        ? friends.map((f) => row({
          user: f,
          status: f.presence,
          sub: `${PRESENCE_LABELS[f.presence]} · Cấp ${f.level}`,
          badge: f.unread,
          attrs: `data-open-dm="${f.id}" role="button" tabindex="0"`,
          actions: '<span class="ui-row-chevron" aria-hidden="true">›</span>',
        })).join('')
        : '<div class="ui-empty">Chưa có bạn bè. Tìm tên ở ô phía trên, hoặc bấm vào tên ai đó trong kênh Thế giới.</div>'),
      outgoing.length
        ? section(`Đã gửi lời mời · ${outgoing.length}`, outgoing.map((u) => row({
          user: u,
          sub: 'Đang chờ đồng ý',
          actions: `<button type="button" class="btn small" data-cancel="${u.id}">Huỷ</button>`,
        })).join(''))
        : '',
    ].join('');
  }

  private async runSearch(raw: string) {
    const box = this.body.querySelector<HTMLElement>('.search-results');
    if (!box) return;
    const q = raw.trim();
    const seq = ++this.searchSeq;
    if (q.length < USER_SEARCH_MIN) {
      box.innerHTML = q ? `<div class="ui-empty">Nhập ít nhất ${USER_SEARCH_MIN} ký tự.</div>` : '';
      return;
    }
    if (!/^[A-Za-z0-9_]+$/.test(q)) {
      box.innerHTML = '<div class="ui-empty">Tên người chơi chỉ gồm chữ không dấu, số và dấu _.</div>';
      return;
    }
    try {
      const users = await this.client.search(q);
      if (seq !== this.searchSeq) return;
      this.searchResults = users;
      box.innerHTML = `<section><h4 class="ui-section-title">Kết quả tìm kiếm</h4>${
        users.length
          ? users.map((u) => row({
            user: u,
            sub: u.mutedUntil ? `🔇 Bị cấm chat đến ${timeLabel(u.mutedUntil)}` : undefined,
            actions: this.searchAction(u),
          })).join('')
          : '<div class="ui-empty">Không tìm thấy người chơi nào.</div>'
      }</section>`;
    } catch (err) {
      if (seq === this.searchSeq) box.innerHTML = `<div class="ui-empty">${esc((err as Error).message)}</div>`;
    }
  }

  private searchAction(u: UserSearchResult): string {
    const support = this.client.isAdmin && !u.admin
      ? `<button type="button" class="ui-iconbtn" data-mute="${u.id}" title="Cấm chat" aria-label="Cấm chat ${esc(u.username)}">🔇</button>
        <button type="button" class="btn small" data-support="${u.id}" title="Nhắn với tư cách quản trị viên">🛡️ Nhắn</button>`
      : '';
    switch (u.relation) {
      case 'friend': return `${support}<button type="button" class="btn small" data-open-dm="${u.id}">Nhắn tin</button>`;
      case 'outgoing': return `${support}<button type="button" class="btn small" disabled>Đã gửi</button>`;
      case 'incoming': return `${support}<button type="button" class="btn primary small" data-accept="${u.id}">Đồng ý</button>`;
      default: return `${support}<button type="button" class="btn primary small" data-add="${u.id}">Kết bạn</button>`;
    }
  }

  private findUser(name: string) {
    this.go({ kind: 'friends' });
    const input = this.body.querySelector<HTMLInputElement>('.friend-search input');
    if (input) input.value = name;
    void this.runSearch(name);
  }

  private async onFriendAction(e: Event) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-add], [data-accept], [data-decline], [data-cancel], [data-open-dm], [data-support], [data-mute]');
    if (!el || (el as HTMLButtonElement).disabled) return;
    const d = el.dataset;
    if (d.openDm) return this.go({ kind: 'dm', peer: d.openDm });
    if (d.support) {
      const user = this.searchResults.find((u) => u.id === d.support);
      return user && this.go({ kind: 'thread', user });
    }
    if (d.mute) {
      const user = this.searchResults.find((u) => u.id === d.mute);
      return user && this.muteUser(user);
    }
    const buttons = this.body.querySelectorAll<HTMLButtonElement>('.friends-view button');
    buttons.forEach((b) => (b.disabled = true));
    try {
      if (d.add) {
        const result = await this.client.requestFriend({ userId: d.add });
        toast(result === 'accepted' ? 'Hai bạn đã trở thành bạn bè!' : 'Đã gửi lời mời kết bạn.');
      } else if (d.accept) {
        await this.client.respond(d.accept, true);
        toast('Đã thêm bạn mới!');
      } else if (d.decline) {
        await this.client.respond(d.decline, false);
      } else if (d.cancel) {
        await this.client.remove(d.cancel);
      }
      const q = this.body.querySelector<HTMLInputElement>('.friend-search input')?.value;
      if (q) await this.runSearch(q);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      buttons.forEach((b) => (b.disabled = false));
      this.renderFriendLists();
    }
  }

  private async muteUser(u: UserSearchResult) {
    const minutes = await choiceDialog<number>({
      title: `Cấm chat ${u.username}?`,
      message: u.mutedUntil
        ? `Đang bị cấm chat đến ${timeLabel(u.mutedUntil)}. Chọn thời hạn mới (tính từ bây giờ) hoặc bỏ cấm.`
        : 'Người này sẽ không gửi được tin ở kênh Thế giới và tin nhắn riêng, nhưng vẫn nhắn được cho quản trị viên.',
      choices: [
        ...MUTE_OPTIONS.map((o) => ({ value: o.minutes as number, label: o.label })),
        ...(u.mutedUntil ? [{ value: 0, label: 'Bỏ cấm chat', danger: true }] : []),
      ],
    });
    if (minutes === null) return;
    try {
      const until = await this.client.mute(u.id, minutes);
      toast(until ? `Đã cấm chat ${u.username} đến ${timeLabel(until)}.` : `Đã bỏ cấm chat cho ${u.username}.`);
      const q = this.body.querySelector<HTMLInputElement>('.friend-search input')?.value;
      if (q) await this.runSearch(q);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  private async unfriend(f: FriendEntry) {
    const ok = await confirmDialog({
      title: 'Huỷ kết bạn?',
      message: `${f.username} sẽ bị xoá khỏi danh sách bạn bè của bạn. Muốn làm bạn lại thì phải gửi lời mời mới.`,
      confirmText: 'Huỷ kết bạn',
      cancelText: 'Giữ lại',
      danger: true,
    });
    if (!ok) return;
    this.go({ kind: 'friends' });
    try {
      await this.client.remove(f.id);
      toast(`Đã huỷ kết bạn với ${f.username}.`);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }
}
