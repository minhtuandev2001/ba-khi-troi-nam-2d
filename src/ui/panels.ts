import {
  AMMO_NAMES,
  ARMOR,
  BAG_CAPACITY,
  ITEMS,
  ITEM_IDS,
  MAX_HP,
  MAX_PLAYERS,
  MEDKIT,
  THROWABLE,
  WEAPONS,
  ZONE_PHASES,
  type WeaponId,
} from '../shared';
import { saveSettings, settings, type Settings } from '../settings';
import { esc, formatDuration } from './dom';

export const KEYBINDS: [string, string][] = [
  ['W A S D / Phím mũi tên', 'Di chuyển'],
  ['Chuột', 'Ngắm (nhân vật quay theo chuột)'],
  ['Chuột trái', 'Bắn / đánh / ném lựu đạn'],
  ['R', 'Thay đạn'],
  ['F', 'Nhặt đồ, mở / đóng cửa, mở thính'],
  ['1 / 2', 'Súng chính 1 / súng chính 2'],
  ['E', 'Súng lục'],
  ['V', 'Dao / tay không'],
  ['3', 'Lựu đạn'],
  ['4', 'Bom khói'],
  ['Q / 5', 'Dùng túi cứu thương'],
  ['Z', 'Đổi ống nhắm'],
  ['Lăn chuột', 'Đổi vũ khí'],
  ['Tab', 'Mở túi đồ'],
  ['M', 'Mở bản đồ lớn'],
  ['Esc', 'Tạm dừng / cài đặt'],
];

export function keysPanel(): string {
  return `
    <table class="list">
      <thead><tr><th>Phím</th><th>Chức năng</th></tr></thead>
      <tbody>${KEYBINDS.map(([k, v]) => `<tr><td>${k.split(' / ').map((p) => `<span class="kbd">${esc(p)}</span>`).join(' / ')}</td><td>${esc(v)}</td></tr>`).join('')}</tbody>
    </table>
    <h3>Trên điện thoại</h3>
    <ul class="muted">
      <li>Chạm và kéo nửa trái màn hình để di chuyển.</li>
      <li>Chạm và kéo nửa phải màn hình để ngắm, kéo xa tâm sẽ tự bắn.</li>
      <li>Khi cầm lựu đạn hoặc bom khói: kéo để ngắm, kéo càng xa thì ném càng xa, thả tay để ném.</li>
      <li>Chạm vào ô vũ khí ở dưới để đổi vũ khí. Các nút bên phải: Nhặt, Thay đạn, Cứu thương, Lựu đạn, Bom khói.</li>
    </ul>`;
}

export function guidePanel(): string {
  const zoneRows = ZONE_PHASES.map(
    (p, i) => `<tr><td>${i + 1}</td><td>${formatDuration(p.waitMs)}</td><td>${formatDuration(p.shrinkMs)}</td><td>${p.damagePerSecond}/giây</td></tr>`,
  ).join('');
  return `
  <div class="guide">
    <h3>Mục tiêu</h3>
    <p>Trận đấu có tối đa ${MAX_PLAYERS} người. Bạn xuất hiện ngẫu nhiên trên bản đồ với hai bàn tay trắng. Hãy nhặt vũ khí, trang bị và là người <b>sống sót cuối cùng</b>.</p>
    <h3>Nhặt đồ và túi đồ</h3>
    <ul>
      <li>Đứng gần vật phẩm rồi bấm <span class="kbd">F</span> để nhặt. Đạn, túi cứu thương, lựu đạn, bom khói và ống nhắm sẽ tự nhặt khi bạn đi qua.</li>
      <li>Mang tối đa <b>2 súng chính</b> (súng trường, shotgun, súng bắn tỉa) cộng thêm <b>1 súng lục</b> và <b>1 vũ khí cận chiến</b>.</li>
      <li>Mỗi loại súng dùng một loại đạn riêng. Túi đồ càng cấp cao thì mang được càng nhiều đạn và vật phẩm.</li>
      <li>Bấm <span class="kbd">Tab</span> để xem túi đồ và vứt bớt đồ.</li>
    </ul>
    <h3>Nhà cửa</h3>
    <p>Bấm <span class="kbd">F</span> gần cửa để mở hoặc đóng. Khi bạn vào một phòng, mái của phòng đó sẽ ẩn đi để bạn thấy bên trong. Người ở ngoài <b>không nhìn thấy</b> người trong phòng, và người ở các phòng khác nhau cũng không thấy nhau.</p>
    <h3>Rương đồ và thính</h3>
    <ul>
      <li><b>Rương đồ</b>: đấm, chém hoặc bắn cho vỡ để lấy lựu đạn, giáp 3, ống nhắm x4, túi cứu thương hoặc súng trường.</li>
      <li><b>Thính</b>: cứ 3 phút rơi một lần, luôn rơi bên trong vòng bo tiếp theo và được báo trên bản đồ. Bên trong có súng bắn tỉa, đạn 7.62, giáp 3 và ống nhắm x6 hoặc x8.</li>
    </ul>
    <h3>Ống nhắm</h3>
    <p>Ống nhắm mở rộng tầm nhìn từ trên xuống. Bấm <span class="kbd">Z</span> để chuyển giữa các ống nhắm bạn có.</p>
    <h3>Vòng bo</h3>
    <p>Vòng bo thu nhỏ qua ${ZONE_PHASES.length} giai đoạn, trận đấu kéo dài khoảng 14–15 phút. Đứng ngoài bo sẽ mất máu liên tục (giáp không giảm sát thương bo). Vòng tròn trắng là vùng an toàn tiếp theo.</p>
    <div class="table-wrap"><table class="list"><thead><tr><th>Giai đoạn</th><th>Chờ</th><th>Thu nhỏ</th><th>Sát thương ngoài bo</th></tr></thead><tbody>${zoneRows}</tbody></table></div>
    <h3>Bom khói và lựu đạn</h3>
    <p>Lựu đạn nổ sau ${THROWABLE.grenade.fuseMs / 1000} giây. Bom khói tạo màn khói che tầm nhìn của tất cả mọi người, kể cả bot, trong ${THROWABLE.smoke.durationMs / 1000} giây.</p>
    <h3>Khi bị hạ gục</h3>
    <p>Bạn có thể xem tiếp người đã hạ mình, xem người chơi khác hoặc về sảnh. Nếu mất mạng giữa trận, nhân vật sẽ đứng yên cho đến khi bạn vào lại.</p>
    <h3>Máu</h3>
    <p>Máu tối đa là ${MAX_HP}. Túi cứu thương hồi ${MEDKIT.heal} máu sau ${MEDKIT.useMs / 1000} giây.</p>
  </div>`;
}

function weaponStats(id: WeaponId): string {
  const w = WEAPONS[id];
  if (w.slot === 'melee') return `Sát thương ${w.damage} · ${w.fireRate} đòn/giây · tầm ${w.range}`;
  const dmg = w.pellets > 1 ? `${w.pellets}×${w.damage}` : `${w.damage}`;
  return `Sát thương ${dmg} · ${w.fireRate} phát/giây · băng ${w.magSize} viên · thay đạn ${w.reloadMs / 1000}s · tầm ${w.range} · độ tản ${w.spread}° · ${AMMO_NAMES[w.ammo!]}`;
}

export function itemsPanel(): string {
  const weapons = (['fists', 'knife', 'pistol', 'rifle', 'shotgun', 'sniper'] as WeaponId[])
    .map((id) => {
      const w = WEAPONS[id];
      const icon = id === 'fists' ? '👊' : ITEMS[id as keyof typeof ITEMS]?.icon ?? '🔫';
      return `<div class="item-row"><div class="ic">${icon}</div><div><h4>${esc(w.name)}</h4><p>${esc(w.desc)}</p><div class="statline">${esc(weaponStats(id))}</div></div></div>`;
    })
    .join('');
  const others = ITEM_IDS.filter((id) => ITEMS[id].kind !== 'weapon')
    .map((id) => {
      const it = ITEMS[id];
      return `<div class="item-row"><div class="ic">${it.icon}</div><div><h4>${esc(it.name)}</h4><p>${esc(it.desc)}</p><div class="statline">Nơi tìm thấy: ${esc(it.source)}</div></div></div>`;
    })
    .join('');
  const bagRows = ([0, 1, 2, 3] as const)
    .map((l) => {
      const c = BAG_CAPACITY[l];
      return `<tr><td>${l === 0 ? 'Không túi' : `Cấp ${l}`}</td><td>${c.ammo['9mm']}</td><td>${c.ammo['556']}</td><td>${c.ammo['12g']}</td><td>${c.ammo['762']}</td><td>${c.medkit}</td><td>${c.grenade}</td><td>${c.smoke}</td></tr>`;
    })
    .join('');
  const armorRows = ([1, 2, 3] as const)
    .map((l) => `<tr><td>Cấp ${l}</td><td>${ARMOR[l].reduction * 100}%</td><td>${ARMOR[l].durability}</td></tr>`)
    .join('');
  return `
    <h3>Vũ khí</h3><div class="grid">${weapons}</div>
    <h3>Vật phẩm</h3><div class="grid">${others}</div>
    <h3>Sức chứa túi đồ</h3>
    <div class="table-wrap"><table class="list"><thead><tr><th>Túi</th><th>9mm</th><th>5.56</th><th>12G</th><th>7.62</th><th>Cứu thương</th><th>Lựu đạn</th><th>Khói</th></tr></thead><tbody>${bagRows}</tbody></table></div>
    <h3>Giáp</h3>
    <div class="table-wrap"><table class="list"><thead><tr><th>Giáp</th><th>Giảm sát thương</th><th>Độ bền</th></tr></thead><tbody>${armorRows}</tbody></table></div>
    <p class="muted">Độ bền giáp giảm đúng bằng lượng sát thương nó chặn được. Khi độ bền về 0, giáp bị vỡ.</p>`;
}

export function settingsPanel(): string {
  const s = settings;
  return `
    <div class="field"><label>Âm lượng: <b id="vol-label">${Math.round(s.volume * 100)}%</b></label>
      <div class="slider-row"><input type="range" min="0" max="100" value="${Math.round(s.volume * 100)}" data-setting="volume" /></div></div>
    <div class="field"><label><input type="checkbox" data-setting="sfx" ${s.sfx ? 'checked' : ''}/> Bật hiệu ứng âm thanh</label></div>
    <div class="field"><label><input type="checkbox" data-setting="damageNumbers" ${s.damageNumbers ? 'checked' : ''}/> Hiện số sát thương</label></div>
    <div class="field"><label><input type="checkbox" data-setting="screenShake" ${s.screenShake ? 'checked' : ''}/> Rung màn hình</label></div>
    <div class="field"><label><input type="checkbox" data-setting="showFps" ${s.showFps ? 'checked' : ''}/> Hiện FPS và ping</label></div>
    <div class="field"><label>Chất lượng đồ họa</label>
      <select class="input" data-setting="quality">
        <option value="high" ${s.quality === 'high' ? 'selected' : ''}>Cao (sắc nét)</option>
        <option value="low" ${s.quality === 'low' ? 'selected' : ''}>Thấp (máy yếu)</option>
      </select></div>
    <div class="field"><label>Điều khiển cảm ứng</label>
      <select class="input" data-setting="touchControls">
        <option value="auto" ${s.touchControls === 'auto' ? 'selected' : ''}>Tự động</option>
        <option value="on" ${s.touchControls === 'on' ? 'selected' : ''}>Luôn bật</option>
        <option value="off" ${s.touchControls === 'off' ? 'selected' : ''}>Tắt</option>
      </select></div>
    <div class="field"><label>Kích thước nút cảm ứng: <b id="touch-label">${Math.round(s.touchSize * 100)}%</b></label>
      <div class="slider-row"><input type="range" min="70" max="140" value="${Math.round(s.touchSize * 100)}" data-setting="touchSize" /></div></div>
    <p class="muted">Một số thay đổi (chất lượng đồ họa, điều khiển cảm ứng) áp dụng từ trận tiếp theo.</p>`;
}

export function bindSettings(root: HTMLElement) {
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]').forEach((el) => {
    const key = el.dataset.setting as keyof Settings;
    el.addEventListener('input', () => {
      let value: unknown;
      if (el instanceof HTMLInputElement && el.type === 'checkbox') value = el.checked;
      else if (el instanceof HTMLInputElement && el.type === 'range') value = Number(el.value) / 100;
      else value = el.value;
      saveSettings({ [key]: value } as Partial<Settings>);
      if (key === 'volume') root.querySelector('#vol-label')!.textContent = `${el.value}%`;
      if (key === 'touchSize') root.querySelector('#touch-label')!.textContent = `${el.value}%`;
    });
  });
}
