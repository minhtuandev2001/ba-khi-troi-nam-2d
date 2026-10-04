import { esc, html } from './dom';

export interface QrDialogOptions {
  title: string;
  subtitle?: string;
  link: string;
  /** Shown under the code, for typing it in by hand. */
  code?: string;
  onCopy: () => void;
  /** However it was closed. */
  onClose?: () => void;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Another phone scanning a link to this machine's loopback address would open its own, finding nothing. */
export function isLocalOnly(link: string): boolean {
  try {
    const host = new URL(link).hostname;
    return LOCAL_HOSTS.has(host) || host.endsWith('.localhost');
  } catch {
    return false;
  }
}

/** The room screen re-renders on every member change, so the last code is kept to redraw it without a flash. */
let svgCache: { link: string; svg: string } | null = null;

export function cachedQrSvg(link: string): string | null {
  return svgCache?.link === link ? svgCache.svg : null;
}

export async function qrSvg(link: string): Promise<string> {
  const hit = cachedQrSvg(link);
  if (hit) return hit;
  const { renderSVG } = await import('uqr');
  const svg = renderSVG(link, { ecc: 'M', border: 2, blackColor: '#2a1406', whiteColor: '#ffffff' });
  svgCache = { link, svg };
  return svg;
}

/** A big QR code of `link`, for players next to each other. Returns a function that closes it. */
export async function showQrDialog({ title, subtitle, link, code, onCopy, onClose }: QrDialogOptions): Promise<() => void> {
  const svg = await qrSvg(link);
  const box = html(`<div class="overlay confirm-modal qr-modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="card">
      <div class="qr-code" role="img" aria-label="Mã QR của ${esc(link)}">${svg}</div>
      <div class="qr-info">
      <h2>${esc(title)}</h2>
      ${subtitle ? `<p class="qr-sub">${esc(subtitle)}</p>` : ''}
      ${code ? `<div class="qr-room-code">Mã phòng: <b>${esc(code)}</b></div>` : ''}
      ${isLocalOnly(link)
        ? '<p class="qr-warn">⚠️ Trang đang mở bằng localhost nên máy khác quét sẽ không vào được. Hãy mở game bằng địa chỉ mạng LAN (ví dụ http://192.168.x.x:5173) hoặc tên miền thật rồi mở lại mã QR.</p>'
        : '<p class="muted">Mở camera điện thoại và quét mã. Người chưa có tài khoản sẽ được yêu cầu đăng ký rồi tự vào phòng.</p>'}
      <div class="row btn-pair">
        <button class="btn" data-a="copy">🔗 Chép link</button>
        <button class="btn primary" data-a="close">Đóng</button>
      </div>
      </div>
    </div></div>`);
  const previous = document.activeElement as HTMLElement | null;
  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    window.removeEventListener('keydown', onKey, true);
    box.remove();
    previous?.focus?.();
    onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  box.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === box) return close();
    const a = t.closest<HTMLElement>('[data-a]')?.dataset.a;
    if (a === 'close') close();
    else if (a === 'copy') onCopy();
  });
  window.addEventListener('keydown', onKey, true);
  document.body.appendChild(box);
  box.querySelector<HTMLElement>('[data-a="close"]')!.focus();
  return close;
}
