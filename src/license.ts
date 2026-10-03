/** Keep in step with LICENSE at the repository root. */
export const COPYRIGHT = '© 2026 Bá Khí - Trời Nam 2D. Bảo lưu mọi quyền (All rights reserved).';

const LICENSE_TEXT = [
  COPYRIGHT,
  'Mã nguồn, hình ảnh, âm thanh, cốt truyện và mọi nội dung của game là tài sản độc quyền.',
  'Không được sao chép, chỉnh sửa, dịch ngược, phân phối hay dùng lại khi chưa có sự cho phép bằng văn bản.',
  'Thư viện bên thứ ba (Phaser, Socket.IO, font Baloo 2…) giữ nguyên giấy phép riêng của chúng.',
].join('\n');

/** License notice plus a self-XSS warning, printed once when the page loads. */
export function printConsoleNotice() {
  console.log(
    '%cBÁ KHÍ%c TRỜI NAM 2D',
    'font: 800 30px "Baloo 2", system-ui, sans-serif; color: #f6c445; text-shadow: 0 2px 0 #6b3a1c, 0 3px 6px rgba(0,0,0,.4);',
    'font: 800 16px "Baloo 2", system-ui, sans-serif; color: #a8641e; letter-spacing: .3em;',
  );
  console.log(`%c${LICENSE_TEXT}`, 'font: 600 12px system-ui, sans-serif; line-height: 1.6; color: #c98a3e;');
  console.log(
    '%cDừng lại!%c Nếu ai đó bảo bạn dán hay gõ thứ gì vào đây, đó là lừa đảo để chiếm tài khoản của bạn.',
    'font: 800 20px system-ui, sans-serif; color: #e0442a;',
    'font: 600 13px system-ui, sans-serif;',
  );
}
