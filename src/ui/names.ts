import { esc } from './dom';

export const ADMIN_TITLE = 'Quản trị viên';

export const adminBadge = () => `<span class="admin-badge" title="${ADMIN_TITLE}">🛡️ Quản trị</span>`;

/** Escaped player name; admin accounts get the gilded style and, unless `badge` is false, the seal after it. */
export function nameHtml(name: string, admin?: boolean, badge = true): string {
  if (!admin) return esc(name);
  return `<span class="admin-name" title="${ADMIN_TITLE}">${esc(name)}</span>${badge ? adminBadge() : ''}`;
}
