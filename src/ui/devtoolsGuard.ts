/**
 * Keeps browser developer tools shut for everyone except admins. This only deters casual poking:
 * the page cannot stop a determined user (other browsers, proxies, view-source:, extensions), so every
 * rule that matters is still enforced by the server.
 */
import { printConsoleNotice } from '../license';
import { disconnectSocket } from '../net';

const ENABLED = import.meta.env.VITE_DEVTOOLS_GUARD !== 'off';
/** A `debugger` statement only takes time when developer tools are open and pause on it. */
const PAUSE_MS = 100;
const CHECK_MS = 1000;
/**
 * With developer tools attached the browser builds a full preview for `console.table` but only a shallow
 * one for `console.log`; with them closed both cost next to nothing. Unlike `debugger` this still works
 * when breakpoints are deactivated.
 */
const TABLE_MIN_MS = 1;
const TABLE_RATIO = 6;
const SAMPLE = Array.from({ length: 50 }, (_, i) => Object.fromEntries(Array.from({ length: 50 }, (_, j) => [`k${j}`, i * j])));

const PANEL_KEYS = ['KeyI', 'KeyJ', 'KeyC', 'KeyK', 'KeyE', 'KeyM', 'KeyA', 'KeyZ'];

/** Blocked from page load; lifted once the signed-in user turns out to be an admin. */
let allowed = !ENABLED;
let timer = 0;
let lock: HTMLElement | null = null;

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

/** Keys that open developer tools in Chrome, Edge, Firefox or Safari, the keyboard context menu, view source and save page. */
function isDevtoolsShortcut(e: KeyboardEvent): boolean {
  if (e.code === 'F12' || e.key === 'F12' || e.key === 'ContextMenu') return true;
  // Firefox: Shift+F7 style editor, Shift+F9 storage; Shift+F10 opens the context menu
  if (e.shiftKey && (e.code === 'F7' || e.code === 'F9' || e.code === 'F10')) return true;
  // Ctrl+Shift on Windows/Linux, Cmd+Option on macOS (Ctrl+Alt alone is AltGr typing on many layouts)
  const panel = (e.ctrlKey && e.shiftKey) || (e.metaKey && e.altKey);
  // Ctrl+Shift+Z is redo while typing and the Firefox debugger elsewhere
  if (panel && PANEL_KEYS.includes(e.code) && !(e.code === 'KeyZ' && isTyping(e.target))) return true;
  return (e.ctrlKey || e.metaKey) && (e.code === 'KeyU' || e.code === 'KeyS');
}

function swallow(e: Event) {
  e.preventDefault();
  e.stopImmediatePropagation();
}

if (ENABLED) {
  window.addEventListener('keydown', (e) => {
    if (!allowed && (lock || isDevtoolsShortcut(e))) swallow(e);
  }, true);
  window.addEventListener('contextmenu', (e) => {
    if (!allowed) swallow(e);
  }, true);
}

function showLock() {
  disconnectSocket();
  lock = document.createElement('div');
  lock.className = 'devtools-lock';
  lock.setAttribute('role', 'alertdialog');
  lock.setAttribute('aria-modal', 'true');
  lock.innerHTML = `<div class="card">
    <div class="devtools-lock-icon" aria-hidden="true">🛡️</div>
    <h2>Công cụ nhà phát triển bị chặn</h2>
    <p>Chỉ quản trị viên mới được mở công cụ kiểm tra trang. Hãy đóng nó lại rồi tải lại trang để chơi tiếp.</p>
    <button class="btn primary" type="button">Tải lại trang</button>
  </div>`;
  lock.querySelector('button')!.addEventListener('click', () => location.reload());
  document.body.append(lock);
  console.clear();
  printConsoleNotice();
}

function consoleAttached(): boolean {
  const t0 = performance.now();
  console.table(SAMPLE);
  const t1 = performance.now();
  console.log(SAMPLE);
  const t2 = performance.now();
  // also keeps the samples from piling up for whoever opens the console later
  console.clear();
  const table = t1 - t0;
  return table >= TABLE_MIN_MS && table > TABLE_RATIO * (t2 - t1);
}

function check() {
  if (allowed) return;
  const started = performance.now();
  debugger;
  if (lock) {
    if (!lock.isConnected) document.body.append(lock);
    return;
  }
  if (performance.now() - started > PAUSE_MS || consoleAttached()) showLock();
}

/** Call once the signed-in user is known (false while signed out); detection starts with the first call. */
export function setDevtoolsAllowed(admin: boolean) {
  if (!ENABLED) return;
  allowed = admin;
  if (admin) {
    clearInterval(timer);
    timer = 0;
    lock?.remove();
    lock = null;
  } else if (!timer) {
    timer = window.setInterval(check, CHECK_MS);
    check();
  }
}
