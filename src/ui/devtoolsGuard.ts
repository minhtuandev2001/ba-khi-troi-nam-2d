/**
 * Blocks the two usual ways into the browser's developer tools, right click and F12, for everyone except
 * admins, and explains why in a dismissible notice. This only deters casual poking (the browser menu, other
 * shortcuts, view-source: and extensions still work), so every rule that matters is enforced by the server.
 */
const ENABLED = import.meta.env.VITE_DEVTOOLS_GUARD !== 'off';

/** Blocked from page load; lifted once the signed-in user turns out to be an admin. */
let allowed = !ENABLED;
let notice: HTMLElement | null = null;

/** Right click is the pickup button in a match, so the game layers only lose the browser menu, without the notice. */
const inGame = (t: EventTarget | null) => t instanceof Element && !!t.closest('#game, #hud, #touch');

/** A long press on a phone or tablet also fires `contextmenu`; only a real mouse (or the menu key) gets the notice. */
function fromTouch(e: MouseEvent): boolean {
  const type = (e as PointerEvent).pointerType;
  return type ? type !== 'mouse' : matchMedia('(pointer: coarse)').matches;
}

function closeNotice() {
  notice?.remove();
  notice = null;
}

function showNotice() {
  if (notice) return;
  notice = document.createElement('div');
  notice.className = 'devtools-lock';
  notice.setAttribute('role', 'alertdialog');
  notice.setAttribute('aria-modal', 'true');
  notice.innerHTML = `<div class="card">
    <div class="devtools-lock-icon" aria-hidden="true">🛡️</div>
    <h2>Thao tác không khả dụng</h2>
    <p>Chuột phải và phím F12 đã bị tắt trên trang này để giữ trận đấu công bằng cho mọi người.</p>
    <button class="btn primary" type="button">Đã hiểu</button>
  </div>`;
  const button = notice.querySelector('button')!;
  button.addEventListener('click', closeNotice);
  document.body.append(notice);
  button.focus();
}

function swallow(e: Event) {
  e.preventDefault();
  e.stopImmediatePropagation();
}

if (ENABLED) {
  window.addEventListener('keydown', (e) => {
    if (allowed) return;
    if (e.code === 'F12' || e.key === 'F12') {
      swallow(e);
      showNotice();
    } else if (notice && e.key === 'Escape') {
      swallow(e);
      closeNotice();
    }
  }, true);
  window.addEventListener('contextmenu', (e) => {
    if (allowed) return;
    e.preventDefault();
    if (!inGame(e.target) && !fromTouch(e)) showNotice();
  }, true);
}

/** Call once the signed-in user is known (false while signed out). */
export function setDevtoolsAllowed(admin: boolean) {
  if (!ENABLED) return;
  allowed = admin;
  if (admin) closeNotice();
}
