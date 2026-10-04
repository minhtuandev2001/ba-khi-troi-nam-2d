export function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function $(selector: string, root: ParentNode = document): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`Không tìm thấy ${selector}`);
  return el;
}

export function html(markup: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild as HTMLElement;
}

export function toast(text: string, kind: 'info' | 'error' = 'info', ms = 3000) {
  const box = document.getElementById('toasts')!;
  const el = html(`<div class="toast ${kind}" style="--life:${ms}ms">${esc(text)}</div>`);
  box.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  /** For actions that cannot be undone: confirming stays disabled until exactly this is typed. */
  typeToConfirm?: string;
}

/** In-game replacement for window.confirm: resolves true on confirm, false on cancel, Escape or a backdrop click. */
export function confirmDialog({ title, message, confirmText = 'Đồng ý', cancelText = 'Huỷ', danger = false, typeToConfirm }: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const box = html(`<div class="overlay confirm-modal" role="dialog" aria-modal="true">
      <div class="card">
        <h2>${esc(title)}</h2>
        ${message ? `<p>${esc(message)}</p>` : ''}
        ${typeToConfirm ? `<label class="field confirm-type"><span>Gõ <b>${esc(typeToConfirm)}</b> để xác nhận</span>
          <input class="input" autocomplete="off" autocapitalize="off" spellcheck="false" /></label>` : ''}
        <div class="row btn-pair">
          <button class="btn" data-a="cancel">${esc(cancelText)}</button>
          <button class="btn ${danger ? 'danger' : 'primary'}" data-a="ok" ${typeToConfirm ? 'disabled' : ''}>${esc(confirmText)}</button>
        </div>
      </div></div>`);
    const okBtn = box.querySelector<HTMLButtonElement>('[data-a="ok"]')!;
    const typed = box.querySelector<HTMLInputElement>('.confirm-type input');
    const allowed = () => !typed || typed.value.trim() === typeToConfirm;
    typed?.addEventListener('input', () => (okBtn.disabled = !allowed()));
    const previous = document.activeElement as HTMLElement | null;
    const done = (ok: boolean) => {
      window.removeEventListener('keydown', onKey, true);
      box.remove();
      previous?.focus?.();
      resolve(ok);
    };
    // captured on window so Escape doesn't also reach panels underneath (e.g. close the social drawer)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') done(false);
      else if (allowed()) done(true);
    };
    box.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === box) return done(false);
      const a = t.closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a === 'cancel' || (a === 'ok' && allowed())) done(a === 'ok');
    });
    window.addEventListener('keydown', onKey, true);
    document.body.appendChild(box);
    (typed ?? okBtn).focus();
  });
}

export interface ChoiceOptions<T> {
  title: string;
  message?: string;
  choices: { value: T; label: string; danger?: boolean }[];
  cancelText?: string;
}

/** Like confirmDialog but with several answers; resolves the picked value, or null on cancel, Escape or a backdrop click. */
export function choiceDialog<T>({ title, message, choices, cancelText = 'Huỷ' }: ChoiceOptions<T>): Promise<T | null> {
  return new Promise((resolve) => {
    const box = html(`<div class="overlay confirm-modal" role="dialog" aria-modal="true">
      <div class="card">
        <h2>${esc(title)}</h2>
        ${message ? `<p>${esc(message)}</p>` : ''}
        <div class="choice-list">
          ${choices.map((c, i) => `<button class="btn ${c.danger ? 'danger' : ''}" data-i="${i}">${esc(c.label)}</button>`).join('')}
        </div>
        <div class="row btn-pair"><button class="btn" data-a="cancel">${esc(cancelText)}</button></div>
      </div></div>`);
    const previous = document.activeElement as HTMLElement | null;
    const done = (value: T | null) => {
      window.removeEventListener('keydown', onKey, true);
      box.remove();
      previous?.focus?.();
      resolve(value);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      done(null);
    };
    box.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === box || t.closest('[data-a="cancel"]')) return done(null);
      const i = t.closest<HTMLElement>('[data-i]')?.dataset.i;
      if (i !== undefined) done(choices[Number(i)].value);
    });
    window.addEventListener('keydown', onKey, true);
    document.body.appendChild(box);
    box.querySelector<HTMLElement>('[data-a="cancel"]')!.focus();
  });
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}
