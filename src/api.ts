import type { AdminAccountList, LeaderboardKind, MatchHistoryEntry, PublicUser, RankBoard, TouchLayouts, UserStats } from './shared';

const TOKEN_KEY = 'br2d_token';

/** Empty in dev: requests go through the Vite proxy on the same origin. */
export const API_URL: string = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly errors: string[] = []) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError('Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? 'Có lỗi xảy ra.', res.status, data.errors ?? []);
  return data as T;
}

export const api = {
  register: (username: string, password: string, avatar: string, fillMs: number, website: string) =>
    request<{ token: string; user: PublicUser }>('POST', '/auth/register', { username, password, avatar, fillMs, website }),
  login: (username: string, password: string) =>
    request<{ token: string; user: PublicUser }>('POST', '/auth/login', { username, password }),
  me: () => request<{ user: PublicUser; inMatch: boolean }>('GET', '/me'),
  setAvatar: (avatar: string) => request<{ user: PublicUser }>('PATCH', '/me/avatar', { avatar }),
  stats: () => request<{ stats: UserStats }>('GET', '/me/stats'),
  history: (limit: number, offset: number) =>
    request<{ items: MatchHistoryEntry[]; total: number }>('GET', `/me/history?limit=${limit}&offset=${offset}`),
  leaderboard: (kind: LeaderboardKind) => request<RankBoard>('GET', `/leaderboard?kind=${kind}`),
  touchLayout: () => request<{ layouts: TouchLayouts }>('GET', '/me/touch-layout'),
  saveTouchLayout: (layouts: TouchLayouts) => request<{ layouts: TouchLayouts }>('PUT', '/me/touch-layout', { layouts }),
  adminAccounts: (q: string) => request<AdminAccountList>('GET', `/admin/accounts?q=${encodeURIComponent(q)}`),
  room: (id: string) => request<{ id: string; name: string; hostName: string; count: number; max: number }>('GET', `/rooms/${id}`),
};
