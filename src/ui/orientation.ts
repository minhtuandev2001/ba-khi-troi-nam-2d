/**
 * Tablets (touch screens between a phone and a computer screen) are held sideways on every screen, not only in
 * matches. Whether the device counts as a tablet is judged from the page's current size, so it is checked again
 * on every resize. Browsers only lock the orientation from a tap, and Android wants fullscreen for it, so the lock
 * is tried on the first tap anywhere. While the tablet is upright and not locked (iPad Safari cannot lock, or the
 * player left fullscreen), a card asks to turn it, with a button that locks it where the browser allows.
 * Tablets also get a rotate button in the match HUD (its waiting phase included), which flips the lock either way.
 */
import { useTouchControls } from '../settings';
import { toast } from './dom';
import { canLockOrientation, isFullscreen, isPhone, isTablet, lockOrientation, unlockOrientation } from './fullscreen';

/** The player chose to keep the tablet upright for the rest of this visit. */
const PORTRAIT_OK_KEY = 'br2d_portrait_ok';
const ROTATE_REFUSED = 'Trình duyệt không cho xoay màn hình lúc này. Hãy xoay máy (tắt khoá xoay màn hình nếu đang bật).';

let tablet = false;
let locked = false;
let autoTried = false;
let card: HTMLElement | null = null;

const onFirstTap = (e: PointerEvent) => {
  window.removeEventListener('pointerup', onFirstTap, true);
  autoTried = true;
  const keepUpright = document.body.classList.contains('portrait-ok') || !!(e.target as Element | null)?.closest?.('[data-portrait]');
  if (tablet && !locked && !keepUpright) void lock(false);
};

export function initTabletLandscape(): void {
  if (sessionStorage.getItem(PORTRAIT_OK_KEY)) document.body.classList.add('portrait-ok');
  window.addEventListener('resize', sync);
  screen.orientation?.addEventListener?.('change', sync);
  for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) {
    // leaving fullscreen releases the lock on Android
    document.addEventListener(ev, () => {
      if (!isFullscreen()) locked = false;
      sync();
    });
  }
  sync();
}

function sync() {
  // the rotate buttons: phones and tablets whose browser can turn the page (not iPhone / iPad Safari)
  document.body.classList.toggle('can-rotate', useTouchControls() && canLockOrientation() && (isPhone() || isTablet()));
  const now = isTablet();
  if (now !== tablet) {
    tablet = now;
    document.body.classList.toggle('tablet-ui', now);
    if (now) showCard();
    else if (locked) {
      locked = false;
      unlockOrientation();
    }
  }
  if (tablet && !locked && !autoTried && canLockOrientation()) window.addEventListener('pointerup', onFirstTap, true);
  else window.removeEventListener('pointerup', onFirstTap, true);
}

/** Must run inside a tap. `report`: say on the card when the browser refuses. */
async function lock(report: boolean) {
  locked = await lockOrientation('landscape');
  if (locked || !report || !card) return;
  card.querySelector('[data-lock]')?.remove();
  const note = card.querySelector<HTMLElement>('[data-note]');
  if (note) note.textContent = 'Trình duyệt này không cho trang web tự xoay màn hình. Hãy xoay ngang máy (tắt khoá xoay màn hình nếu đang bật).';
}

function keepUpright() {
  sessionStorage.setItem(PORTRAIT_OK_KEY, '1');
  document.body.classList.add('portrait-ok');
}

/** The rotate button: turns the screen to the other orientation. Must run inside a tap. */
export async function rotateScreen(): Promise<void> {
  const target = matchMedia('(orientation: portrait)').matches ? 'landscape' : 'portrait';
  // a tablet turned upright on purpose must not get the "turn it sideways" card
  if (target === 'portrait' && tablet) keepUpright();
  const ok = await lockOrientation(target);
  if (tablet) locked = ok && target === 'landscape';
  if (!ok) toast(ROTATE_REFUSED, 'error', 4000);
}

function showCard() {
  if (card) return;
  card = document.createElement('div');
  card.className = 'tablet-rotate';
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-labelledby', 'tablet-rotate-title');
  card.innerHTML = `
    <div class="rotate-phone tablet" aria-hidden="true"></div>
    <b id="tablet-rotate-title">Xoay ngang máy tính bảng</b>
    <p>Trên máy tính bảng, trò chơi hiển thị theo chiều ngang ở mọi trang.</p>
    ${canLockOrientation() ? '<button type="button" class="btn primary" data-lock>Xoay ngang</button>' : ''}
    <p class="muted" data-note>Nếu màn hình không tự xoay, hãy tắt khoá xoay màn hình của máy.</p>
    <button type="button" class="btn small" data-portrait>Vẫn dùng màn hình dọc</button>`;
  card.querySelector('[data-lock]')?.addEventListener('click', () => void lock(true));
  card.querySelector('[data-portrait]')!.addEventListener('click', keepUpright);
  document.body.appendChild(card);
}
