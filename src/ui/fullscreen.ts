/**
 * Fullscreen for matches on phones. Browsers only allow entering it from a tap, so the lobby asks on the button
 * that leads into a match and the touch controls retry on the first touch in the match; the server's
 * match start itself arrives too late to count as a tap. iPhone Safari has no fullscreen API for pages,
 * so everything here quietly does nothing there.
 */
import { useTouchControls } from '../settings';

/** Phones either way up; tablets are big enough to keep the browser bars. */
const PHONE_QUERY = '(max-width: 600px), (max-height: 500px)';

type FullscreenDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> };
type FullscreenEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
type LockableOrientation = ScreenOrientation & { lock?: (o: 'landscape') => Promise<void> };

/** Set when this app turned fullscreen on, so leaving a match never undoes fullscreen the player chose. */
let ours = false;

export function isPhone(): boolean {
  return useTouchControls() && matchMedia(PHONE_QUERY).matches;
}

export function canFullscreen(): boolean {
  const el = document.documentElement as FullscreenEl;
  return typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function';
}

export function isFullscreen(): boolean {
  return !!(document.fullscreenElement ?? (document as FullscreenDoc).webkitFullscreenElement);
}

/** Call from a tap handler. Resolves once fullscreen is on, or right away when it is refused or unsupported. */
export async function enterFullscreen(): Promise<void> {
  if (!isPhone() || !canFullscreen() || isFullscreen()) return;
  const el = document.documentElement as FullscreenEl;
  try {
    await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.());
    ours = true;
  } catch {
    // refused (no tap, iframe, user setting): the page simply stays as it is
  }
}

/** Holds the screen sideways; browsers only allow it while fullscreen (Android). */
export async function lockLandscape(): Promise<void> {
  if (!isFullscreen()) return;
  try {
    await (screen.orientation as LockableOrientation | undefined)?.lock?.('landscape');
  } catch {
    // unsupported: the rotate hint asks the player instead
  }
}

/** Undoes `lockLandscape` and, if this app turned it on, fullscreen. */
export function leaveFullscreen(): void {
  try {
    screen.orientation?.unlock?.();
  } catch {
    // not locked
  }
  if (!ours) return;
  ours = false;
  if (!isFullscreen()) return;
  const doc = document as FullscreenDoc;
  void (doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.())?.catch(() => {});
}
