export const SERVER_WAKING_TEXT = 'Máy chủ đang khởi động, lần đầu có thể mất tới 1 phút…';

type NetState = 'hidden' | 'connecting' | 'lost';

/** Small always-on-top pill that tells the player when the game server is unreachable. */
export class NetStatus {
  private readonly el: HTMLElement;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'net-status hidden';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    document.body.appendChild(this.el);
  }

  set(state: NetState, detail?: string) {
    this.el.classList.toggle('hidden', state === 'hidden');
    this.el.classList.toggle('lost', state === 'lost');
    document.body.classList.toggle('net-offline', state !== 'hidden');
    if (state === 'hidden') return;
    const title = state === 'lost' ? 'Mất kết nối, đang kết nối lại…' : 'Đang kết nối máy chủ…';
    this.el.innerHTML = `<span class="dot"></span><span><b>${title}</b>${detail ? `<small>${detail}</small>` : ''}</span>`;
  }
}
