import { api } from '../api';
import { sanitizeTouchLayout, sanitizeTouchLayouts, type TouchLayout, type TouchLayouts, type TouchProfile } from '../shared';
import { toast } from './dom';

/**
 * The account's arrangement is kept in the database; this browser holds a copy so a match can start before the
 * server answers, and so the editor works offline.
 */
const KEY = 'br2d_touch_layout';

interface Cache {
  owner: string | null;
  layouts: TouchLayouts;
}

let owner: string | null = null;
let pushTimer = 0;

function readCache(): Cache {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as unknown;
    if (raw && typeof raw === 'object' && 'layouts' in raw) {
      const c = raw as { owner?: unknown; layouts?: unknown };
      return { owner: typeof c.owner === 'string' ? c.owner : null, layouts: sanitizeTouchLayouts(c.layouts) };
    }
    // the first release kept one arrangement per browser, before it belonged to an account
    return { owner: null, layouts: sanitizeTouchLayouts(raw) };
  } catch {
    return { owner: null, layouts: {} };
  }
}

function writeCache(layouts: TouchLayouts) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ owner, layouts }));
  } catch {
    // private mode or a full quota: the server copy still holds it
  }
}

/** Someone else's arrangement left in this browser never applies to the account signed in now. */
function current(): TouchLayouts {
  const c = readCache();
  return c.owner === null || c.owner === owner ? c.layouts : {};
}

export function layoutProfile(): TouchProfile {
  if (matchMedia('(orientation: landscape) and (max-height: 500px)').matches) return 'phone';
  return matchMedia('(orientation: landscape)').matches ? 'land' : 'port';
}

export function loadLayout(profile: TouchProfile): TouchLayout {
  return { ...current()[profile] };
}

export function saveLayout(profile: TouchProfile, layout: TouchLayout) {
  const layouts = { ...current() };
  const clean = sanitizeTouchLayout(layout);
  if (Object.keys(clean).length) layouts[profile] = clean;
  else delete layouts[profile];
  writeCache(layouts);
  if (owner) push(layouts);
}

function push(layouts: TouchLayouts) {
  clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    api.saveTouchLayout(layouts).catch((err) =>
      toast(`Chưa lưu được bố cục nút lên máy chủ (vẫn dùng được trên máy này): ${(err as Error).message}`, 'error', 5000),
    );
  }, 300);
}

/**
 * After signing in: the account's saved arrangement replaces this browser's copy. One made here before
 * arrangements belonged to accounts is uploaded, so nobody has to redo it.
 */
export async function syncLayouts(userId: string) {
  owner = userId;
  let server: TouchLayouts;
  try {
    server = (await api.touchLayout()).layouts;
  } catch {
    return;
  }
  if (owner !== userId) return;
  const cache = readCache();
  if (Object.keys(server).length || cache.owner !== null) {
    writeCache(server);
    return;
  }
  writeCache(cache.layouts);
  if (Object.keys(cache.layouts).length) push(cache.layouts);
}
