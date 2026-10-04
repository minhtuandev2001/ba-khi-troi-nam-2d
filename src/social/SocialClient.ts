import type { Socket } from 'socket.io-client';
import {
  CHAT_PAGE_SIZE,
  SUPPORT_KEY,
  WORLD_CHANNEL,
  dmPeer,
  supportOwner,
  type ChatMessage,
  type FriendEntry,
  type FriendsState,
  type Presence,
  type PublicUser,
  type SocialAck,
  type SupportStatus,
  type SupportThread,
  type UserSearchResult,
} from '../shared';

/**
 * A conversation is the world channel, a DM keyed by the friend's id, `support` for a player's own thread
 * with the admins, or `support:<player id>` for a thread in an admin's inbox.
 */
export type ConvoKey = typeof WORLD_CHANNEL | string;

export const threadKey = (userId: string): ConvoKey => `support:${userId}`;

export interface Convo {
  messages: ChatMessage[];
  loaded: boolean;
  hasOlder: boolean;
}

export type SocialChange =
  | { type: 'friends'; newIncoming: string[] }
  | { type: 'presence'; userId: string }
  | { type: 'message'; key: ConvoKey; message: ChatMessage }
  | { type: 'history'; key: ConvoKey }
  | { type: 'unread' }
  | { type: 'support' }
  | { type: 'muted'; until: string | null; auto: boolean };

const MAX_KEPT = 200;

/** Social state and the socket calls behind it; views subscribe and redraw only what changed. */
export class SocialClient {
  me: PublicUser | null = null;
  state: FriendsState = { friends: [], incoming: [], outgoing: [] };
  worldUnread = 0;
  /** Player side: admin replies not read yet. */
  supportUnread = 0;
  adminOnline = false;
  /** Admin side: support threads, newest first. */
  inbox: SupportThread[] = [];
  inboxLoaded = false;
  /** The conversation currently on screen; its messages count as read. */
  viewing: ConvoKey | null = null;

  private socket: Socket | null = null;
  private readonly convos = new Map<ConvoKey, Convo>();
  private readonly listeners = new Set<(c: SocialChange) => void>();
  private friendsLoaded = false;

  subscribe(fn: (c: SocialChange) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(change: SocialChange) {
    for (const fn of this.listeners) fn(change);
  }

  attach(socket: Socket, me: PublicUser) {
    this.socket = socket;
    this.me = me;
    socket.on('chat:msg', (m: ChatMessage) => this.receive(m));
    socket.on('friend:changed', () => void this.loadFriends());
    socket.on('chat:muted', (e: { until?: unknown; auto?: unknown }) =>
      this.emit({ type: 'muted', until: typeof e?.until === 'string' ? e.until : null, auto: e?.auto === true }));
    socket.on('chat:purge', (e: { userId?: unknown }) => {
      if (typeof e?.userId === 'string') this.purge(e.userId);
    });
    socket.on('friend:presence', (e: { userId: string; presence: Presence }) => {
      const f = this.friend(e.userId);
      if (!f) return;
      f.presence = e.presence;
      this.emit({ type: 'presence', userId: e.userId });
    });
    // anything may have happened while the socket was down
    socket.on('connect', () => {
      void this.loadFriends();
      void this.loadSupport();
      for (const key of this.convos.keys()) void this.loadHistory(key);
    });
    if (socket.connected) {
      void this.loadFriends();
      void this.loadSupport();
    }
  }

  detach() {
    this.socket = null;
    this.me = null;
    this.state = { friends: [], incoming: [], outgoing: [] };
    this.convos.clear();
    this.worldUnread = 0;
    this.supportUnread = 0;
    this.adminOnline = false;
    this.inbox = [];
    this.inboxLoaded = false;
    this.viewing = null;
    this.friendsLoaded = false;
  }

  /** A deleted account: its messages and conversations go away. */
  private purge(userId: string) {
    this.convos.delete(userId);
    this.convos.delete(threadKey(userId));
    for (const [key, c] of this.convos) {
      const kept = c.messages.filter((m) => m.from.id !== userId);
      if (kept.length === c.messages.length) continue;
      c.messages = kept;
      this.emit({ type: 'history', key });
    }
    if (this.inbox.some((t) => t.user.id === userId)) {
      this.inbox = this.inbox.filter((t) => t.user.id !== userId);
      this.emit({ type: 'support' });
    }
  }

  setMe(me: PublicUser) {
    this.me = me;
  }

  get connected(): boolean {
    return !!this.socket?.connected;
  }

  get isAdmin(): boolean {
    return this.me?.role === 'admin';
  }

  get unreadTotal(): number {
    return this.worldUnread + this.dmUnread + this.state.incoming.length + this.supportBadge;
  }

  /** Unread admin replies for a player, unread player messages across the inbox for an admin. */
  get supportBadge(): number {
    return this.isAdmin ? this.inbox.reduce((n, t) => n + t.unread, 0) : this.supportUnread;
  }

  thread(userId: string): SupportThread | undefined {
    return this.inbox.find((t) => t.user.id === userId);
  }

  get dmUnread(): number {
    return this.state.friends.reduce((n, f) => n + f.unread, 0);
  }

  friend(id: string): FriendEntry | undefined {
    return this.state.friends.find((f) => f.id === id);
  }

  convo(key: ConvoKey): Convo {
    let c = this.convos.get(key);
    if (!c) {
      c = { messages: [], loaded: false, hasOlder: false };
      this.convos.set(key, c);
    }
    return c;
  }

  // ---------------------------------------------------------------- requests

  private async call<T>(event: string, arg: object = {}): Promise<T> {
    const s = this.socket;
    if (!s?.connected) throw new Error('Chưa kết nối được máy chủ.');
    let res: SocialAck<T>;
    try {
      res = await s.timeout(8000).emitWithAck(event, arg);
    } catch {
      throw new Error('Máy chủ không phản hồi, vui lòng thử lại.');
    }
    if (!res.ok) throw new Error(res.error);
    return res;
  }

  async loadFriends() {
    const before = new Set(this.state.incoming.map((u) => u.id));
    const res = await this.call<FriendsState>('friend:list').catch(() => null);
    if (!res) return;
    this.state = { friends: res.friends, incoming: res.incoming, outgoing: res.outgoing };
    const newIncoming = this.friendsLoaded ? res.incoming.filter((u) => !before.has(u.id)).map((u) => u.username) : [];
    this.friendsLoaded = true;
    this.emit({ type: 'friends', newIncoming });
  }

  /** Refreshes the support badge and whether an admin is online; admins also get their inbox. */
  async loadSupport() {
    const status = await this.call<SupportStatus>('support:status').catch(() => null);
    if (!status) return;
    this.supportUnread = status.unread;
    this.adminOnline = status.adminOnline;
    if (this.isAdmin) {
      const res = await this.call<{ threads: SupportThread[] }>('support:inbox').catch(() => null);
      if (res) {
        this.inbox = res.threads;
        this.inboxLoaded = true;
      }
    }
    this.emit({ type: 'support' });
  }

  /** Loads the newest page of a conversation, or the page before what is already loaded. */
  async loadHistory(key: ConvoKey, older = false) {
    const c = this.convo(key);
    const before = older ? c.messages[0]?.id : undefined;
    const res = await this.call<{ messages: ChatMessage[] }>('chat:history', { to: key === WORLD_CHANNEL ? undefined : key, before });
    if (older) {
      c.messages = [...res.messages, ...c.messages];
    } else {
      // keep anything that arrived live after the page was cut
      const lastId = res.messages.at(-1)?.id;
      const tail = lastId ? c.messages.filter((m) => BigInt(m.id) > BigInt(lastId)) : c.messages;
      c.messages = [...res.messages, ...tail];
    }
    if (!older || res.messages.length) c.hasOlder = res.messages.length >= CHAT_PAGE_SIZE;
    if (!older) c.loaded = true;
    this.emit({ type: 'history', key });
  }

  /** Resolves the server's warning when the filter had to mask part of the message. */
  async send(key: ConvoKey, text: string): Promise<string | undefined> {
    const { message, warn } = await this.call<{ message: ChatMessage; warn?: string }>('chat:send', { to: key === WORLD_CHANNEL ? undefined : key, text });
    this.push(key, message);
    if (this.isAdmin) this.touchThread(message);
    return warn;
  }

  search(q: string) {
    return this.call<{ users: UserSearchResult[] }>('user:search', { q }).then((r) => r.users);
  }

  /** Admins only: bans a player from world chat and DMs for `minutes`, 0 lifts the ban. Resolves the ban's end. */
  mute(userId: string, minutes: number) {
    return this.call<{ until: string | null }>('admin:mute', { userId, minutes }).then((r) => r.until);
  }

  /** Admins only: deletes a player's account for good. */
  deleteUser(userId: string) {
    return this.call<{ username: string }>('admin:deleteUser', { userId }).then((r) => r.username);
  }

  async requestFriend(target: { username?: string; userId?: string }) {
    const r = await this.call<{ result: 'sent' | 'accepted' }>('friend:request', target);
    await this.loadFriends();
    return r.result;
  }

  async respond(userId: string, accept: boolean) {
    await this.call('friend:respond', { userId, accept });
    await this.loadFriends();
  }

  async remove(userId: string) {
    await this.call('friend:remove', { userId });
    this.convos.delete(userId);
    await this.loadFriends();
  }

  /** Marks what is on screen as read, locally and (for DMs and support) on the server. */
  markViewed(key: ConvoKey) {
    if (key === WORLD_CHANNEL) {
      if (this.worldUnread) {
        this.worldUnread = 0;
        this.emit({ type: 'unread' });
      }
      return;
    }
    const last = this.convos.get(key)?.messages.at(-1);
    if (!last) return;
    let hadUnread: boolean;
    if (key === SUPPORT_KEY) {
      hadUnread = this.supportUnread > 0;
      this.supportUnread = 0;
    } else {
      const owner = supportOwner(key);
      const entry = owner ? this.thread(owner) : this.friend(key);
      if (!entry && !owner) return;
      hadUnread = (entry?.unread ?? 0) > 0;
      if (entry) entry.unread = 0;
    }
    if (hadUnread) this.emit({ type: 'unread' });
    if (hadUnread || last.from.id !== this.me?.id) void this.call('chat:read', { to: key, id: last.id }).catch(() => undefined);
  }

  // ---------------------------------------------------------------- incoming

  private receive(m: ChatMessage) {
    const me = this.me?.id;
    if (!me) return;
    const owner = supportOwner(m.channel);
    if (owner) return this.receiveSupport(m, owner);
    const key: ConvoKey | null = m.channel === WORLD_CHANNEL ? WORLD_CHANNEL : dmPeer(m.channel, me);
    if (!key) return;
    this.push(key, m);
    if (this.viewing === key) {
      this.markViewed(key);
    } else if (key === WORLD_CHANNEL) {
      this.worldUnread++;
      this.emit({ type: 'unread' });
    } else {
      const f = this.friend(key);
      if (f) f.unread++;
      this.emit({ type: 'unread' });
    }
  }

  private receiveSupport(m: ChatMessage, owner: string) {
    const mine = owner === this.me?.id;
    if (!mine && !this.isAdmin) return;
    const key = mine ? SUPPORT_KEY : threadKey(owner);
    this.push(key, m);
    if (mine) {
      if (this.viewing === key) this.markViewed(key);
      else if (m.from.id !== owner) {
        this.supportUnread++;
        this.emit({ type: 'unread' });
      }
      return;
    }
    const t = this.touchThread(m);
    // only the player's own messages count as unread for admins, matching the server
    if (t && m.from.id === owner && this.viewing !== key) t.unread++;
    if (this.viewing === key) this.markViewed(key);
    this.emit({ type: 'unread' });
  }

  /** Moves a thread to the top of the inbox with its new last message; reloads the inbox for unknown threads. */
  private touchThread(m: ChatMessage): SupportThread | undefined {
    const owner = supportOwner(m.channel);
    if (!owner) return undefined;
    const t = this.thread(owner);
    if (!t) {
      void this.loadSupport();
      return undefined;
    }
    t.last = { text: m.text, at: m.at, fromAdmin: m.from.id !== owner };
    this.inbox = [t, ...this.inbox.filter((x) => x !== t)];
    this.emit({ type: 'support' });
    return t;
  }

  private push(key: ConvoKey, m: ChatMessage) {
    const c = this.convo(key);
    if (c.messages.some((x) => x.id === m.id)) return;
    c.messages.push(m);
    if (c.messages.length > MAX_KEPT) {
      c.messages.splice(0, c.messages.length - MAX_KEPT);
      c.hasOlder = true;
    }
    this.emit({ type: 'message', key, message: m });
  }
}
