import { esc, html } from './dom';

export const STORY_TITLE = 'Truyền thuyết Bá Khí Trời Nam';

const STORY: string[] = [
  'Thuở các Vua Hùng dựng nước Văn Lang, cứ mỗi độ mùa lũ Thủy Tinh lại dâng nước, quyết cướp lấy đất Phong Châu. Để tìm người đủ bá khí giữ yên bờ cõi, Vua Hùng mở <b>Hội thi Bá Khí</b>: dũng sĩ khắp các bộ Lạc Việt, Âu Việt cùng vào đấu trường với hai bàn tay trắng.',
  'Cung tên, nỏ, ống thổi và giáp trụ được giấu trong nhà sàn, rương gỗ, chum vại khắp Cổ Loa, Nghĩa Lĩnh, làng Lạc Việt. Nước Thủy Tinh dâng lên từng đợt, đất khô thu hẹp dần; ai lạc ngoài vùng an toàn sẽ bị sóng dữ bào mòn sức lực.',
  'Cứ ít lâu, chim Lạc thần lại thả xuống một chiếc <b>trống đồng</b> đựng báu vật: thần tiễn, tên móng rùa của thần Kim Quy, giáp đồng và chim tinh mắt nhất. Tiếng trống vang xa, kẻ dám tranh trống sẽ mạnh hơn, nhưng cũng thành cái đích của cả đấu trường.',
  'Người cuối cùng còn đứng vững sẽ được Vua Hùng phong danh hiệu <b>Bá Khí Trời Nam</b>. Hãy nhặt vũ khí, thuần phục chim trinh sát, tránh nước dữ và viết nên truyền thuyết của chính mình.',
];

export function storyHtml(): string {
  return STORY.map((p) => `<p>${p}</p>`).join('');
}

/** Shown once, right after an account is created; the same text opens the guide. */
export function showStoryDialog(name: string): Promise<void> {
  return new Promise((resolve) => {
    const box = html(`<div class="overlay confirm-modal story-modal" role="dialog" aria-modal="true" aria-labelledby="story-title">
      <div class="card">
        <div class="story-kicker">Chào mừng dũng sĩ <span>${esc(name)}</span></div>
        <h2 id="story-title">${esc(STORY_TITLE)}</h2>
        <div class="story-body">${storyHtml()}</div>
        <button class="btn primary" data-a="ok">Vào hội thi</button>
        <p class="muted story-note">Đọc lại bất cứ lúc nào ở mục Hướng dẫn.</p>
      </div></div>`);
    const done = () => {
      window.removeEventListener('keydown', onKey, true);
      box.remove();
      resolve();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();
      done();
    };
    box.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-a="ok"]')) done();
    });
    window.addEventListener('keydown', onKey, true);
    document.body.appendChild(box);
    box.querySelector<HTMLElement>('[data-a="ok"]')!.focus();
  });
}
